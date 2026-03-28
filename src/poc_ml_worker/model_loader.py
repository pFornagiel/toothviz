import logging
from pathlib import Path
import onnxruntime as ort

logger = logging.getLogger(__name__)

def load_onnx_model(model_path: str | Path) -> ort.InferenceSession:
    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")
        
    logger.info(f"Init ONNX: {path.name}")
    
    providers = ['CPUExecutionProvider']
    
    try:
        session = ort.InferenceSession(str(path), providers=providers)
        
        input_name = session.get_inputs()[0].name
        input_shape = session.get_inputs()[0].shape
        logger.info(f"Model expected input: '{input_name}' with shape: {input_shape}")
        
        return session
        
    except Exception as e:
        logger.error(f"Error while loading model: {e}")
        raise