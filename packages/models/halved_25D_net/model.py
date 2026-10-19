from functools import partial

import torch
from timm.layers import make_divisible
from timm.models._efficientnet_blocks import (
    DepthwiseSeparableConv,
    InvertedResidual,
    SqueezeExcite,
)
from torch import nn

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


class MobileDecoderBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.upsample = nn.ConvTranspose2d(in_channels, out_channels, 2, 2, bias=False)
        # sees the upsampled features and the skip, both out_channels wide
        self.conv1 = DepthwiseSeparableConvWrapper(2 * out_channels, out_channels)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        return self.conv1(torch.cat([self.upsample(x), skip], dim=1))


class MobileNet25DHalf(nn.Module):
    def __init__(self, in_channels: int = 5, num_classes: int = 36):
        super(MobileNet25DHalf, self).__init__()

        self.encoder = nn.ModuleList(
            [
                nn.Sequential(  # /3, 32
                    Conv2dBatchnormActivation(in_channels, 32, kernel_size=3, act=HS)
                ),
                nn.Sequential(IR(32, 64, 64, 3, 2, HS, False)),  # /2, 64
                nn.Sequential(IR(64, 128, 128, 3, 2, HS, False)),  # /4, 128
                nn.Sequential(IR(128, 256, 256, 3, 2, HS, False)),  # /8, 256
                nn.Sequential(IR(256, 512, 512, 3, 2, HS, False)),  # /16, 512
                nn.Sequential(IR(512, 1024, 512, 3, 2, HS, False)),  # /32, 512
                nn.Sequential(IR(512, 1024, 512, 3, 2, HS, False)),  # /64, 512
            ]
        )

        self.decoder = nn.ModuleList(
            [
                MobileDecoderBlock(512, 512),  # /64 -> /32
                MobileDecoderBlock(512, 512),  # /32 -> /16
                MobileDecoderBlock(512, 256),  # /16 -> /8
                MobileDecoderBlock(256, 128),  # /8  -> /4
                MobileDecoderBlock(128, 64),  # /4  -> /2
                MobileDecoderBlock(64, 32),  # /2  -> /1
            ]
        )

        self.segmentation_head = nn.Conv2d(32, num_classes, 1)

    def forward(self, x: torch.Tensor):
        skips = []
        for stage in self.encoder:
            x = stage(x)
            skips.append(x)
        y = skips.pop()
        for block in self.decoder:
            y = block(y, skips.pop())
        return self.segmentation_head(y)


def load_trained(checkpoint_path: str, num_classes: int = 36) -> MobileNet25DHalf:
    """
    MobileNet25DHalf with the weights of the trained ``...MobileNet25DHalfCtx5ch`` arm.

    The checkpoint already uses this module's names, so it loads as is.
    """
    weights = torch.load(checkpoint_path, map_location="cpu", weights_only=False)[
        "network_weights"
    ]
    net = MobileNet25DHalf(in_channels=5, num_classes=num_classes)
    net.load_state_dict(weights)
    return net.eval()


if __name__ == "__main__":
    from pathlib import Path

    # Here, not at the top: the trainers import this module, and must not need the exporter
    from ..export_to_onnx import export_to_onnx

    parent_dir = Path(__file__).resolve().parent
    exports_dir = parent_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)

    net = load_trained(parent_dir / "ctx5ch_checkpoint_final.pth")
    export_to_onnx(net, 5, exports_dir / "mobile_25D_half.onnx")