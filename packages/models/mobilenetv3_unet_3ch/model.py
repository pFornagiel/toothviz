from functools import partial

import torch
import torch.nn.functional as F
from timm.layers import make_divisible
from timm.models._efficientnet_blocks import (
    DepthwiseSeparableConv,
    InvertedResidual,
    SqueezeExcite,
)
from torch import nn

from ..export_to_onnx import export_to_onnx

# MobileNetV3's squeeze-excite block
MobileNetSE = partial(
    SqueezeExcite,
    gate_layer="hard_sigmoid",
    force_act_layer=nn.ReLU,
    rd_round_fn=make_divisible,
)


# Inverted Residual Wrapper
def IR(
    in_channels: int,
    expanded: int,
    out_channels: int,
    kernel_size: int,
    stride: int,
    act: type,
    se: bool,
) -> InvertedResidual:
    return InvertedResidual(
        in_channels,
        out_channels,
        dw_kernel_size=kernel_size,
        stride=stride,
        exp_ratio=expanded / in_channels,
        act_layer=act,
        se_layer=MobileNetSE if se else None,
    )


def DepthwiseSeparableConvWrapper(
    in_channels: int, out_channels: int, kernel_size: int = 3, act: type = nn.ReLU
) -> DepthwiseSeparableConv:
    return DepthwiseSeparableConv(
        in_channels,
        out_channels,
        dw_kernel_size=kernel_size,
        noskip=True,
        pw_act=True,
        act_layer=act,
    )


def Conv2dBatchnormActivation(
    in_channels: int,
    out_channels: int,
    kernel_size: int = 3,
    stride: int = 1,
    act: type = nn.ReLU,
) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(
            in_channels,
            out_channels,
            kernel_size,
            stride,
            padding=kernel_size // 2,
            bias=False,
        ),
        nn.BatchNorm2d(out_channels),
        act(inplace=True),
    )


RE = nn.ReLU
HS = nn.Hardswish


# Mimicks the
# https://github.com/huggingface/pytorch-image-models/blob/c709c9a4a26af45d01221caadfdc6b00a9622630/timm/models/mobilenetv3.py#L570


class MobileNetV3Encoder(torch.nn.Module):
    SKIP_CONNECTIONS = [0, 1, 2, 4, 6]
    OUT_CHANNELS = (16, 24, 40, 112, 960)

    def __init__(self, in_channels: int = 3):
        super().__init__()
        self.stem = Conv2dBatchnormActivation(in_channels, 16, act=HS, stride=2)

        self.blocks = nn.Sequential(
            nn.Sequential(
                DepthwiseSeparableConv(16, 16, dw_kernel_size=3, act_layer=RE)
            ),
            nn.Sequential(
                IR(16, 64, 24, 3, 2, RE, False), IR(24, 72, 24, 3, 1, RE, False)
            ),
            nn.Sequential(
                IR(24, 72, 40, 5, 2, RE, True),
                IR(40, 120, 40, 5, 1, RE, True),
                IR(40, 120, 40, 5, 1, RE, True),
            ),
            nn.Sequential(
                IR(40, 240, 80, 3, 2, HS, False),
                IR(80, 200, 80, 3, 1, HS, False),
                IR(80, 184, 80, 3, 1, HS, False),
                IR(80, 184, 80, 3, 1, HS, False),
            ),
            nn.Sequential(
                IR(80, 480, 112, 3, 1, HS, True), IR(112, 672, 112, 3, 1, HS, True)
            ),
            nn.Sequential(
                IR(112, 672, 160, 5, 2, HS, True),
                IR(160, 960, 160, 5, 1, HS, True),
                IR(160, 960, 160, 5, 1, HS, True),
            ),
            nn.Sequential(Conv2dBatchnormActivation(160, 960, kernel_size=1, act=HS)),
        )

    def forward(self, x: torch.Tensor):
        x = self.stem(x)
        features = []
        for i, block in enumerate(self.blocks):
            x = block(x)
            if i in self.SKIP_CONNECTIONS:
                features.append(x)
        return features


class UNetDecoderBlock(nn.Module):
    def __init__(
        self,
        in_channels: int,
        skip_channels: int,
        out_channels: int,
        separable: bool = False,
    ):
        super().__init__()
        conv = DepthwiseSeparableConvWrapper if separable else Conv2dBatchnormActivation
        self.conv1 = conv(in_channels + skip_channels, out_channels)
        self.conv2 = conv(out_channels, out_channels)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, size=skip.shape[2:], mode="nearest")
        return self.conv2(self.conv1(torch.cat([x, skip], dim=1)))


class MobileNetV3UNet3Ch(torch.nn.Module):
    FULL_RES_CHANNEL_SIZE = 16
    DECODER_CHANNELS = (256, 128, 64, 32, 16)

    def __init__(self, in_channels: int = 3, num_classes: int = 32):
        super(MobileNetV3UNet3Ch, self).__init__()

        self.full_res_conv = nn.Sequential(
            Conv2dBatchnormActivation(
                in_channels, self.FULL_RES_CHANNEL_SIZE, kernel_size=3
            ),
            Conv2dBatchnormActivation(
                self.FULL_RES_CHANNEL_SIZE, self.FULL_RES_CHANNEL_SIZE, kernel_size=3
            ),
        )

        self.encoder = MobileNetV3Encoder(in_channels)

        bottleneck_channels, *skip_channels = reversed(MobileNetV3Encoder.OUT_CHANNELS)
        skip_channels.append(self.FULL_RES_CHANNEL_SIZE)
        decoder_inputs = [bottleneck_channels, *self.DECODER_CHANNELS[:-1]]

        self.decoder_blocks = nn.ModuleList(
            [
                UNetDecoderBlock(
                    decoder_in_channels, decoder_skip_channels, decoder_out_channels
                )
                for decoder_in_channels, decoder_skip_channels, decoder_out_channels in zip(
                    decoder_inputs, skip_channels, self.DECODER_CHANNELS
                )
            ]
        )

        self.segmentation_head = nn.Conv2d(
            self.DECODER_CHANNELS[-1], num_classes, 3, padding=1
        )

    def forward(self, x: torch.Tensor):
        full_res = self.full_res_conv(x)
        *skips, bottom = self.encoder(x)
        skips = [*reversed(skips), full_res]  # /16, /8, /4, /2, /1
        y = bottom
        for block, skip in zip(self.decoder_blocks, skips):
            y = block(y, skip)
        return self.segmentation_head(y)


def load_trained(checkpoint_path: str, num_classes: int = 36) -> MobileNetV3UNet3Ch:
    """
    MobileNetV3UNet3Ch with the weights of a trained ``...MobileNetFullRes`` arm.

    The checkpoint uses the repo network's names (timm/smp); this renames them.
    """
    rename = {
        "full_res.": "full_res_conv.",
        "encoder.conv_stem.": "encoder.stem.0.",
        "encoder.bn1.": "encoder.stem.1.",
        "encoder.blocks.6.0.conv.": "encoder.blocks.6.0.0.",
        "encoder.blocks.6.0.bn1.": "encoder.blocks.6.0.1.",
        "decoder.blocks.": "decoder_blocks.",
        "segmentation_head.0.": "segmentation_head.",
    }
    weights = torch.load(checkpoint_path, map_location="cpu", weights_only=False)[
        "network_weights"
    ]
    renamed = {}
    for key, value in weights.items():
        for old, new in rename.items():
            if key.startswith(old):
                key = new + key[len(old) :]
                break
        renamed[key] = value

    net = MobileNetV3UNet3Ch(in_channels=3, num_classes=num_classes)
    net.load_state_dict(renamed)
    return net.eval()


if __name__ == "__main__":
    from pathlib import Path

    parent_dir = Path(__file__).resolve().parent
    exports_dir = parent_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)

    net = load_trained(parent_dir / "weights_mobilenetv3_unet_3ch.pth")
    export_to_onnx(net, 3, exports_dir / "mobilenetv3_unet_3ch.onnx")
