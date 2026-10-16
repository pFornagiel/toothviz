import torch
from torch.export import Dim

STANDARD_INPUT_HW = (384, 384)
STANDARD_BATCH_SIZE = 1


def export_to_onnx(net: torch.nn.Module, input_channels: int, output_path: str):
    dummy_input = torch.randn(STANDARD_BATCH_SIZE, input_channels, *STANDARD_INPUT_HW)
    batch = Dim("batch_size")
    height = Dim("height")
    width = Dim("width")
    torch.onnx.export(
        net,
        (dummy_input,),
        output_path,
        verbose=True,
        verify=True,
        export_params=True,
        dynamo=True,
        input_names=["input"],
        output_names=["output"],
        dynamic_shapes={
            "x": {0: batch, 2: height, 3: width},
        },
    )
