"""
Configuration management for STT processor.
"""

import os
from typing import Optional, Dict, Any
from dataclasses import dataclass
from pathlib import Path


@dataclass
class STTConfig:
    """Configuration for STT processing pipeline."""
    
    # Model settings
    whisper_model: str = "large-v3"
    whisper_device: str = "auto"  # auto, cpu, cuda
    compute_type: str = "float16"  # float16, int8, float32
    
    # Audio processing
    vad_onset: float = 0.5
    vad_offset: float = 0.363
    chunk_length: int = 30
    
    # Diarization settings
    min_speakers: Optional[int] = None
    max_speakers: Optional[int] = None
    num_speakers: Optional[int] = None
    
    # Performance settings
    batch_size: int = 16
    num_workers: int = 0
    use_gpu: bool = True
    gpu_memory_limit: Optional[float] = None  # GB
    
    # Output settings
    language: str = "pt"
    task: str = "transcribe"  # transcribe, translate
    
    # File handling
    supported_formats: tuple = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".avi", ".mov")
    max_file_size_mb: int = 500
    temp_dir: str = "/tmp/stt_processing"
    
    # Logging
    log_level: str = "INFO"
    structured_logging: bool = True
    
    @classmethod
    def from_env(cls) -> "STTConfig":
        """Create configuration from environment variables."""
        return cls(
            whisper_model=os.getenv("WHISPER_MODEL", "large-v3"),
            whisper_device=os.getenv("WHISPER_DEVICE", "auto"),
            compute_type=os.getenv("COMPUTE_TYPE", "float16"),
            vad_onset=float(os.getenv("VAD_ONSET", "0.5")),
            vad_offset=float(os.getenv("VAD_OFFSET", "0.363")),
            chunk_length=int(os.getenv("CHUNK_LENGTH", "30")),
            min_speakers=int(os.getenv("MIN_SPEAKERS")) if os.getenv("MIN_SPEAKERS") else None,
            max_speakers=int(os.getenv("MAX_SPEAKERS")) if os.getenv("MAX_SPEAKERS") else None,
            num_speakers=int(os.getenv("NUM_SPEAKERS")) if os.getenv("NUM_SPEAKERS") else None,
            batch_size=int(os.getenv("BATCH_SIZE", "16")),
            num_workers=int(os.getenv("NUM_WORKERS", "0")),
            use_gpu=os.getenv("USE_GPU", "true").lower() == "true",
            gpu_memory_limit=float(os.getenv("GPU_MEMORY_LIMIT")) if os.getenv("GPU_MEMORY_LIMIT") else None,
            language=os.getenv("LANGUAGE", "pt"),
            task=os.getenv("TASK", "transcribe"),
            max_file_size_mb=int(os.getenv("MAX_FILE_SIZE_MB", "500")),
            temp_dir=os.getenv("TEMP_DIR", "/tmp/stt_processing"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            structured_logging=os.getenv("STRUCTURED_LOGGING", "true").lower() == "true"
        )
    
    def get_device(self) -> str:
        """Determine the best device to use."""
        if self.whisper_device == "auto":
            import torch
            if torch.cuda.is_available() and self.use_gpu:
                return "cuda"
            else:
                return "cpu"
        return self.whisper_device
    
    def validate(self) -> None:
        """Validate configuration parameters."""
        if self.whisper_model not in ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"]:
            raise ValueError(f"Invalid whisper_model: {self.whisper_model}")
        
        if self.compute_type not in ["float16", "int8", "float32"]:
            raise ValueError(f"Invalid compute_type: {self.compute_type}")
        
        if self.language not in ["pt", "en", "es", "auto"]:
            raise ValueError(f"Invalid language: {self.language}")
        
        if self.task not in ["transcribe", "translate"]:
            raise ValueError(f"Invalid task: {self.task}")
        
        if self.min_speakers and self.max_speakers:
            if self.min_speakers > self.max_speakers:
                raise ValueError("min_speakers cannot be greater than max_speakers")
        
        # Create temp directory if it doesn't exist
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert configuration to dictionary."""
        return {
            "whisper_model": self.whisper_model,
            "whisper_device": self.whisper_device,
            "compute_type": self.compute_type,
            "vad_onset": self.vad_onset,
            "vad_offset": self.vad_offset,
            "chunk_length": self.chunk_length,
            "min_speakers": self.min_speakers,
            "max_speakers": self.max_speakers,
            "num_speakers": self.num_speakers,
            "batch_size": self.batch_size,
            "num_workers": self.num_workers,
            "use_gpu": self.use_gpu,
            "gpu_memory_limit": self.gpu_memory_limit,
            "language": self.language,
            "task": self.task,
            "max_file_size_mb": self.max_file_size_mb,
            "temp_dir": self.temp_dir,
            "log_level": self.log_level,
            "structured_logging": self.structured_logging,
            "actual_device": self.get_device()
        }