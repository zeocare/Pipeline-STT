"""
Data models for STT processing pipeline.
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
import uuid


@dataclass
class SpeakerSegment:
    """Represents a segment of audio with speaker information."""
    
    start_time: float
    end_time: float
    speaker_id: str
    text: str
    confidence: float
    words: List[Dict[str, Any]] = field(default_factory=list)
    
    @property
    def duration(self) -> float:
        """Duration of the segment in seconds."""
        return self.end_time - self.start_time
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "start_time": self.start_time,
            "end_time": self.end_time,
            "speaker_id": self.speaker_id,
            "text": self.text,
            "confidence": self.confidence,
            "duration": self.duration,
            "words": self.words
        }


@dataclass
class TranscriptionResult:
    """Complete transcription result with metadata."""
    
    # Core results
    segments: List[SpeakerSegment]
    full_text: str
    speakers: List[str]
    
    # Metadata
    audio_duration: float
    processing_time: float
    model_version: str
    language: str = "pt"
    
    # Processing info
    job_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=datetime.utcnow)
    
    # Quality metrics
    overall_confidence: float = 0.0
    word_count: int = 0
    speaker_count: int = 0
    
    def __post_init__(self):
        """Calculate derived metrics after initialization."""
        if self.segments:
            # Calculate overall confidence as weighted average
            total_duration = sum(seg.duration for seg in self.segments)
            if total_duration > 0:
                self.overall_confidence = sum(
                    seg.confidence * seg.duration for seg in self.segments
                ) / total_duration
            
            # Count words and speakers
            self.word_count = len(self.full_text.split())
            self.speaker_count = len(self.speakers)
    
    def get_speaker_segments(self, speaker_id: str) -> List[SpeakerSegment]:
        """Get all segments for a specific speaker."""
        return [seg for seg in self.segments if seg.speaker_id == speaker_id]
    
    def get_transcript_by_speaker(self) -> Dict[str, str]:
        """Get full transcript organized by speaker."""
        speaker_texts = {}
        for speaker in self.speakers:
            segments = self.get_speaker_segments(speaker)
            speaker_texts[speaker] = " ".join(seg.text for seg in segments)
        return speaker_texts
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "job_id": self.job_id,
            "created_at": self.created_at.isoformat(),
            "audio_duration": self.audio_duration,
            "processing_time": self.processing_time,
            "model_version": self.model_version,
            "language": self.language,
            "overall_confidence": self.overall_confidence,
            "word_count": self.word_count,
            "speaker_count": self.speaker_count,
            "speakers": self.speakers,
            "full_text": self.full_text,
            "segments": [seg.to_dict() for seg in self.segments],
            "transcript_by_speaker": self.get_transcript_by_speaker()
        }


@dataclass 
class ProcessingJob:
    """Represents a processing job with status tracking."""
    
    job_id: str
    file_path: str
    status: str = "pending"  # pending, processing, completed, failed
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    result: Optional[TranscriptionResult] = None
    
    def mark_started(self):
        """Mark job as started."""
        self.status = "processing"
        self.started_at = datetime.utcnow()
    
    def mark_completed(self, result: TranscriptionResult):
        """Mark job as completed with result."""
        self.status = "completed"
        self.completed_at = datetime.utcnow()
        self.result = result
    
    def mark_failed(self, error: str):
        """Mark job as failed with error message."""
        self.status = "failed"
        self.completed_at = datetime.utcnow()
        self.error_message = error
    
    @property
    def total_processing_time(self) -> Optional[float]:
        """Total processing time in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None