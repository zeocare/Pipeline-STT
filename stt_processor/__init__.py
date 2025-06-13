"""
STT Processor - Production-grade Speech-to-Text Pipeline
=======================================================

High-performance transcription engine with speaker diarization and PII redaction
for Brazilian healthcare environments with LGPD compliance.

Features:
- Whisper Large-v3 for state-of-the-art transcription accuracy
- WhisperX for precise speaker diarization and alignment
- spaCy-based PII redaction for healthcare data protection
- OpenTelemetry instrumentation for observability
- GPU optimization with memory management
- Structured logging with contextual information
"""

__version__ = "1.0.0"
__author__ = "Pipeline STT Team"

from .main import STTProcessor
from .models import TranscriptionResult, SpeakerSegment, ProcessingJob
from .config import STTConfig

__all__ = [
    "STTProcessor",
    "TranscriptionResult", 
    "SpeakerSegment",
    "ProcessingJob",
    "STTConfig"
]