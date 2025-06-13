"""
Production-grade STT Processor with Whisper Large-v3 + WhisperX
================================================================

High-performance speech-to-text engine optimized for Brazilian Portuguese
healthcare consultations with advanced speaker diarization.
"""

import asyncio
import gc
import logging
import time
import traceback
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import librosa
import numpy as np
import soundfile as sf
import torch
import whisper
import whisperx

from .config import STTConfig
from .models import ProcessingJob, SpeakerSegment, TranscriptionResult


class STTProcessor:
    """
    Production-grade Speech-to-Text processor with speaker diarization.
    
    Features:
    - Whisper Large-v3 for high-accuracy transcription
    - WhisperX for precise speaker diarization and word-level alignment
    - GPU memory optimization with automatic cleanup
    - Robust error handling and recovery
    - Structured logging with performance metrics
    """
    
    def __init__(self, config: Optional[STTConfig] = None):
        """Initialize STT processor with configuration."""
        self.config = config or STTConfig.from_env()
        self.config.validate()
        
        # Setup logging
        self._setup_logging()
        
        # Model storage
        self.whisper_model = None
        self.whisperx_model = None
        self.align_model = None
        self.diarize_model = None
        
        # Device configuration
        self.device = self.config.get_device()
        self.compute_type = self.config.compute_type
        
        # Performance tracking
        self.processing_stats = {
            "jobs_processed": 0,
            "total_audio_duration": 0.0,
            "total_processing_time": 0.0,
            "average_rtf": 0.0  # Real-time factor
        }
        
        self.logger.info(
            "STT Processor initialized",
            extra={
                "config": self.config.to_dict(),
                "device": self.device,
                "gpu_available": torch.cuda.is_available(),
                "gpu_count": torch.cuda.device_count() if torch.cuda.is_available() else 0
            }
        )
    
    def _setup_logging(self):
        """Setup structured logging."""
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(getattr(logging, self.config.log_level))
        
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            if self.config.structured_logging:
                import structlog
                structlog.configure(
                    processors=[
                        structlog.contextvars.merge_contextvars,
                        structlog.processors.add_log_level,
                        structlog.processors.TimeStamper(fmt="iso"),
                        structlog.dev.ConsoleRenderer()
                    ],
                    wrapper_class=structlog.make_filtering_bound_logger(self.config.log_level),
                    context_class=dict,
                    logger_factory=structlog.PrintLoggerFactory(),
                    cache_logger_on_first_use=False,
                )
                self.logger = structlog.get_logger()
            else:
                formatter = logging.Formatter(
                    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
                )
                handler.setFormatter(formatter)
                self.logger.addHandler(handler)
    
    @contextmanager
    def _gpu_memory_manager(self):
        """Context manager for GPU memory optimization."""
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                initial_memory = torch.cuda.memory_allocated()
                self.logger.debug(f"GPU memory before operation: {initial_memory / 1024**3:.2f} GB")
            
            yield
            
        finally:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                gc.collect()
                final_memory = torch.cuda.memory_allocated()
                self.logger.debug(f"GPU memory after cleanup: {final_memory / 1024**3:.2f} GB")
    
    def _load_whisper_model(self):
        """Load Whisper model with optimization."""
        if self.whisper_model is None:
            self.logger.info(f"Loading Whisper model: {self.config.whisper_model}")
            start_time = time.time()
            
            with self._gpu_memory_manager():
                self.whisper_model = whisper.load_model(
                    self.config.whisper_model,
                    device=self.device
                )
            
            load_time = time.time() - start_time
            self.logger.info(
                f"Whisper model loaded successfully",
                extra={
                    "model": self.config.whisper_model,
                    "device": self.device,
                    "load_time": load_time
                }
            )
    
    def _load_whisperx_models(self):
        """Load WhisperX models for diarization and alignment."""
        if self.whisperx_model is None:
            self.logger.info("Loading WhisperX models")
            start_time = time.time()
            
            with self._gpu_memory_manager():
                # Load WhisperX model
                self.whisperx_model = whisperx.load_model(
                    self.config.whisper_model,
                    self.device,
                    compute_type=self.compute_type,
                    language=self.config.language
                )
                
                # Load alignment model
                self.align_model, metadata = whisperx.load_align_model(
                    language_code=self.config.language,
                    device=self.device
                )
                
                # Load diarization model (using pyannote)
                from pyannote.audio import Pipeline
                self.diarize_model = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    use_auth_token=None  # Add HuggingFace token if needed
                ).to(torch.device(self.device))
            
            load_time = time.time() - start_time
            self.logger.info(
                f"WhisperX models loaded successfully",
                extra={"load_time": load_time}
            )
    
    def _preprocess_audio(self, audio_path: Union[str, Path]) -> Tuple[np.ndarray, int]:
        """
        Preprocess audio file for optimal transcription.
        
        Args:
            audio_path: Path to audio file
            
        Returns:
            Tuple of (audio_data, sample_rate)
        """
        audio_path = Path(audio_path)
        
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
        if audio_path.suffix.lower() not in self.config.supported_formats:
            raise ValueError(f"Unsupported audio format: {audio_path.suffix}")
        
        # Check file size
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        if file_size_mb > self.config.max_file_size_mb:
            raise ValueError(f"File too large: {file_size_mb:.1f}MB > {self.config.max_file_size_mb}MB")
        
        self.logger.info(
            f"Preprocessing audio file",
            extra={
                "file_path": str(audio_path),
                "file_size_mb": file_size_mb
            }
        )
        
        # Load audio with librosa for robust format support
        audio_data, sample_rate = librosa.load(
            str(audio_path),
            sr=16000,  # WhisperX expects 16kHz
            mono=True
        )
        
        # Normalize audio
        audio_data = librosa.util.normalize(audio_data)
        
        duration = len(audio_data) / sample_rate
        self.logger.info(
            f"Audio preprocessed",
            extra={
                "duration": duration,
                "sample_rate": sample_rate,
                "channels": 1
            }
        )
        
        return audio_data, sample_rate
    
    def _transcribe_with_whisperx(self, audio_data: np.ndarray) -> Dict:
        """Transcribe audio using WhisperX."""
        self.logger.info("Starting WhisperX transcription")
        start_time = time.time()
        
        with self._gpu_memory_manager():
            # Transcribe
            result = self.whisperx_model.transcribe(
                audio_data,
                batch_size=self.config.batch_size,
                language=self.config.language,
                task=self.config.task
            )
        
        transcription_time = time.time() - start_time
        self.logger.info(
            f"WhisperX transcription completed",
            extra={
                "transcription_time": transcription_time,
                "segments_count": len(result.get("segments", []))
            }
        )
        
        return result
    
    def _align_transcription(self, transcription_result: Dict, audio_data: np.ndarray) -> Dict:
        """Align transcription with audio for word-level timestamps."""
        self.logger.info("Starting transcript alignment")
        start_time = time.time()
        
        with self._gpu_memory_manager():
            aligned_result = whisperx.align(
                transcription_result["segments"],
                self.align_model,
                whisperx.utils.LANGUAGES[self.config.language],
                audio_data,
                self.device,
                return_char_alignments=False
            )
        
        alignment_time = time.time() - start_time
        self.logger.info(
            f"Transcript alignment completed",
            extra={"alignment_time": alignment_time}
        )
        
        return aligned_result
    
    def _perform_diarization(self, audio_data: np.ndarray, aligned_result: Dict) -> Dict:
        """Perform speaker diarization."""
        self.logger.info("Starting speaker diarization")
        start_time = time.time()
        
        with self._gpu_memory_manager():
            # Perform diarization
            audio_tensor = torch.tensor(audio_data).unsqueeze(0)
            diarization_result = self.diarize_model(
                {"waveform": audio_tensor, "sample_rate": 16000},
                min_speakers=self.config.min_speakers,
                max_speakers=self.config.max_speakers,
                num_speakers=self.config.num_speakers
            )
            
            # Assign speakers to segments
            diarized_result = whisperx.assign_word_speakers(
                diarization_result, aligned_result
            )
        
        diarization_time = time.time() - start_time
        
        # Count unique speakers
        speakers_found = set()
        for segment in diarized_result.get("segments", []):
            if "speaker" in segment:
                speakers_found.add(segment["speaker"])
        
        self.logger.info(
            f"Speaker diarization completed",
            extra={
                "diarization_time": diarization_time,
                "speakers_found": len(speakers_found),
                "speaker_ids": list(speakers_found)
            }
        )
        
        return diarized_result
    
    def _parse_results(self, diarized_result: Dict, audio_duration: float, processing_time: float) -> TranscriptionResult:
        """Parse WhisperX results into structured format."""
        segments = []
        full_text_parts = []
        speakers = set()
        
        for segment_data in diarized_result.get("segments", []):
            # Extract speaker info
            speaker_id = segment_data.get("speaker", "SPEAKER_UNKNOWN")
            speakers.add(speaker_id)
            
            # Create segment
            segment = SpeakerSegment(
                start_time=segment_data["start"],
                end_time=segment_data["end"],
                speaker_id=speaker_id,
                text=segment_data["text"].strip(),
                confidence=segment_data.get("avg_logprob", 0.0),
                words=segment_data.get("words", [])
            )
            
            segments.append(segment)
            full_text_parts.append(f"[{speaker_id}]: {segment.text}")
        
        # Create final result
        result = TranscriptionResult(
            segments=segments,
            full_text=" ".join(full_text_parts),
            speakers=list(speakers),
            audio_duration=audio_duration,
            processing_time=processing_time,
            model_version=f"whisper-{self.config.whisper_model}+whisperx",
            language=self.config.language
        )
        
        return result
    
    async def process_file(self, audio_path: Union[str, Path]) -> TranscriptionResult:
        """
        Process audio file with full STT pipeline.
        
        Args:
            audio_path: Path to audio file
            
        Returns:
            Complete transcription result with speaker diarization
        """
        job_start_time = time.time()
        audio_path = Path(audio_path)
        
        self.logger.info(
            f"Starting STT processing",
            extra={"file_path": str(audio_path)}
        )
        
        try:
            # Load models
            self._load_whisper_model() 
            self._load_whisperx_models()
            
            # Preprocess audio
            audio_data, sample_rate = self._preprocess_audio(audio_path)
            audio_duration = len(audio_data) / sample_rate
            
            # Transcription pipeline
            transcription_result = self._transcribe_with_whisperx(audio_data)
            aligned_result = self._align_transcription(transcription_result, audio_data)
            diarized_result = self._perform_diarization(audio_data, aligned_result)
            
            # Parse results
            total_processing_time = time.time() - job_start_time
            result = self._parse_results(diarized_result, audio_duration, total_processing_time)
            
            # Update stats
            self.processing_stats["jobs_processed"] += 1
            self.processing_stats["total_audio_duration"] += audio_duration
            self.processing_stats["total_processing_time"] += total_processing_time
            self.processing_stats["average_rtf"] = (
                self.processing_stats["total_processing_time"] / 
                self.processing_stats["total_audio_duration"]
            )
            
            self.logger.info(
                f"STT processing completed successfully",
                extra={
                    "job_id": result.job_id,
                    "processing_time": total_processing_time,
                    "audio_duration": audio_duration,
                    "rtf": total_processing_time / audio_duration,
                    "word_count": result.word_count,
                    "speaker_count": result.speaker_count,
                    "overall_confidence": result.overall_confidence
                }
            )
            
            return result
            
        except Exception as e:
            error_msg = f"STT processing failed: {str(e)}"
            self.logger.error(
                error_msg,
                extra={
                    "file_path": str(audio_path),
                    "error_type": type(e).__name__,
                    "traceback": traceback.format_exc()
                }
            )
            raise RuntimeError(error_msg) from e
    
    def process_file_sync(self, audio_path: Union[str, Path]) -> TranscriptionResult:
        """Synchronous wrapper for process_file."""
        return asyncio.run(self.process_file(audio_path))
    
    def get_stats(self) -> Dict:
        """Get processing statistics."""
        return {
            **self.processing_stats,
            "config": self.config.to_dict()
        }
    
    def cleanup(self):
        """Clean up resources and models."""
        self.logger.info("Cleaning up STT processor resources")
        
        # Clear models
        self.whisper_model = None
        self.whisperx_model = None
        self.align_model = None
        self.diarize_model = None
        
        # GPU cleanup
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        gc.collect()
        self.logger.info("STT processor cleanup completed")
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.cleanup()


# Factory function for easy instantiation
def create_stt_processor(config: Optional[STTConfig] = None) -> STTProcessor:
    """Create STT processor instance with optional configuration."""
    return STTProcessor(config)