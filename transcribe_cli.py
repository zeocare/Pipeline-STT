#!/usr/bin/env python3
"""
CLI para Transcrição de Consultas Médicas
=========================================

Interface de linha de comando para processar arquivos de áudio de consultas
psiquiátricas com transcrição de alta qualidade e diarização de speakers.

Uso:
    python transcribe_cli.py arquivo.mp3
    python transcribe_cli.py pasta_com_audios/
    python transcribe_cli.py arquivo.wav --speakers 2 --output json
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import List, Optional

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

from stt_processor import STTProcessor, STTConfig, TranscriptionResult

# Rich console para output formatado
console = Console()
app = typer.Typer(
    name="transcribe",
    help="🎤 Transcrição de consultas médicas com diarização de speakers",
    no_args_is_help=True
)


def validate_audio_file(file_path: Path) -> bool:
    """Valida se o arquivo é um áudio válido."""
    if not file_path.exists():
        console.print(f"❌ Arquivo não encontrado: {file_path}", style="red")
        return False
    
    supported_formats = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".avi", ".mov")
    if file_path.suffix.lower() not in supported_formats:
        console.print(f"❌ Formato não suportado: {file_path.suffix}", style="red")
        console.print(f"Formatos aceitos: {', '.join(supported_formats)}", style="yellow")
        return False
    
    # Verificar tamanho do arquivo
    file_size_mb = file_path.stat().st_size / (1024 * 1024)
    if file_size_mb > 500:
        console.print(f"❌ Arquivo muito grande: {file_size_mb:.1f}MB (máximo: 500MB)", style="red")
        return False
    
    return True


def find_audio_files(path: Path) -> List[Path]:
    """Encontra todos os arquivos de áudio em um diretório."""
    if path.is_file():
        return [path] if validate_audio_file(path) else []
    
    audio_files = []
    supported_formats = (".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4", ".avi", ".mov")
    
    for ext in supported_formats:
        audio_files.extend(path.glob(f"*{ext}"))
        audio_files.extend(path.glob(f"*{ext.upper()}"))
    
    # Validar arquivos encontrados
    valid_files = [f for f in audio_files if validate_audio_file(f)]
    
    if not valid_files:
        console.print(f"❌ Nenhum arquivo de áudio válido encontrado em: {path}", style="red")
    
    return sorted(valid_files)


def format_duration(seconds: float) -> str:
    """Formata duração em segundos para formato legível."""
    mins, secs = divmod(int(seconds), 60)
    hours, mins = divmod(mins, 60)
    
    if hours > 0:
        return f"{hours}h{mins:02d}m{secs:02d}s"
    elif mins > 0:
        return f"{mins}m{secs:02d}s"
    else:
        return f"{secs}s"


def display_transcription_summary(result: TranscriptionResult) -> None:
    """Exibe resumo da transcrição de forma organizada."""
    
    # Cabeçalho com métricas
    metrics_table = Table(title="📊 Métricas de Processamento", show_header=True)
    metrics_table.add_column("Métrica", style="cyan")
    metrics_table.add_column("Valor", style="green")
    
    metrics_table.add_row("⏱️ Duração do Áudio", format_duration(result.audio_duration))
    metrics_table.add_row("🔧 Tempo de Processamento", format_duration(result.processing_time))
    metrics_table.add_row("⚡ Fator Tempo Real", f"{result.processing_time/result.audio_duration:.2f}x")
    metrics_table.add_row("🎯 Confiança Média", f"{result.overall_confidence:.2%}")
    metrics_table.add_row("👥 Speakers Identificados", str(result.speaker_count))
    metrics_table.add_row("📝 Total de Palavras", str(result.word_count))
    metrics_table.add_row("🧠 Modelo", result.model_version)
    
    console.print(metrics_table)
    console.print()
    
    # Transcrição por speaker
    for speaker_id in result.speakers:
        speaker_segments = result.get_speaker_segments(speaker_id)
        total_speaking_time = sum(seg.duration for seg in speaker_segments)
        
        # Painel para cada speaker
        speaker_text = " ".join(seg.text for seg in speaker_segments)
        
        panel_title = f"🎤 {speaker_id} - {format_duration(total_speaking_time)} de fala"
        console.print(Panel(
            speaker_text,
            title=panel_title,
            border_style="blue" if "SPEAKER_00" in speaker_id else "green"
        ))
        console.print()


def save_results(result: TranscriptionResult, output_path: Path, format_type: str) -> None:
    """Salva os resultados em diferentes formatos."""
    
    if format_type == "json":
        output_file = output_path.with_suffix(".json")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(result.to_dict(), f, ensure_ascii=False, indent=2)
        console.print(f"💾 Resultado salvo em: {output_file}", style="green")
    
    elif format_type == "txt":
        output_file = output_path.with_suffix(".txt")
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"Transcrição: {output_path.name}\n")
            f.write(f"Data: {result.created_at.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Duração: {format_duration(result.audio_duration)}\n")
            f.write(f"Speakers: {result.speaker_count}\n")
            f.write("="*60 + "\n\n")
            
            for speaker_id in result.speakers:
                segments = result.get_speaker_segments(speaker_id)
                f.write(f"\n[{speaker_id}]:\n")
                for segment in segments:
                    timestamp = f"[{format_duration(segment.start_time)}-{format_duration(segment.end_time)}]"
                    f.write(f"{timestamp} {segment.text}\n")
        
        console.print(f"💾 Transcrição salva em: {output_file}", style="green")
    
    elif format_type == "srt":
        output_file = output_path.with_suffix(".srt")
        with open(output_file, 'w', encoding='utf-8') as f:
            subtitle_counter = 1
            for segment in result.segments:
                start_time = format_srt_timestamp(segment.start_time)
                end_time = format_srt_timestamp(segment.end_time)
                
                f.write(f"{subtitle_counter}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"[{segment.speaker_id}]: {segment.text}\n\n")
                subtitle_counter += 1
        
        console.print(f"💾 Legenda salva em: {output_file}", style="green")


def format_srt_timestamp(seconds: float) -> str:
    """Formata timestamp para formato SRT."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


@app.command()
def transcribe(
    input_path: str = typer.Argument(..., help="Arquivo de áudio ou pasta com arquivos"),
    output_dir: Optional[str] = typer.Option(None, "--output", "-o", help="Diretório de saída (padrão: mesmo local do arquivo)"),
    format_type: str = typer.Option("txt", "--format", "-f", help="Formato de saída: txt, json, srt"),
    speakers: Optional[int] = typer.Option(None, "--speakers", "-s", help="Número conhecido de speakers"),
    min_speakers: Optional[int] = typer.Option(None, "--min-speakers", help="Número mínimo de speakers"),
    max_speakers: Optional[int] = typer.Option(None, "--max-speakers", help="Número máximo de speakers"),
    model: str = typer.Option("large-v3", "--model", "-m", help="Modelo Whisper: tiny, base, small, medium, large, large-v3"),
    device: str = typer.Option("auto", "--device", "-d", help="Dispositivo: auto, cpu, cuda"),
    language: str = typer.Option("pt", "--language", "-l", help="Idioma: pt, en, es, auto"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Modo verboso"),
    quiet: bool = typer.Option(False, "--quiet", "-q", help="Modo silencioso")
):
    """
    🎤 Transcreve arquivos de áudio com diarização de speakers.
    
    Exemplos:
    
        transcribe consulta.mp3
        
        transcribe audios/ --speakers 2 --format json
        
        transcribe entrevista.wav --min-speakers 2 --max-speakers 4
    """
    
    if quiet and verbose:
        console.print("❌ Não é possível usar --quiet e --verbose ao mesmo tempo", style="red")
        raise typer.Exit(1)
    
    # Configuração
    config = STTConfig(
        whisper_model=model,
        whisper_device=device,
        language=language,
        num_speakers=speakers,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        log_level="DEBUG" if verbose else "WARNING" if quiet else "INFO"
    )
    
    # Validar formato de saída
    if format_type not in ["txt", "json", "srt"]:
        console.print("❌ Formato inválido. Use: txt, json, srt", style="red")
        raise typer.Exit(1)
    
    # Encontrar arquivos
    input_path_obj = Path(input_path)
    audio_files = find_audio_files(input_path_obj)
    
    if not audio_files:
        raise typer.Exit(1)
    
    # Diretório de saída
    if output_dir:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = input_path_obj.parent if input_path_obj.is_file() else input_path_obj
    
    if not quiet:
        console.print(f"🎤 Processando {len(audio_files)} arquivo(s) com modelo {model}", style="bold blue")
        console.print(f"💾 Resultados serão salvos em: {output_path}", style="blue")
        console.print()
    
    # Processar arquivos
    total_start_time = time.time()
    successful_files = 0
    
    with STTProcessor(config) as processor:
        for i, audio_file in enumerate(audio_files, 1):
            if not quiet:
                console.print(f"📁 [{i}/{len(audio_files)}] Processando: {audio_file.name}", style="bold")
            
            try:
                # Processar arquivo
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    BarColumn(),
                    TimeElapsedColumn(),
                    console=console,
                    disable=quiet
                ) as progress:
                    
                    task = progress.add_task("Transcrevendo...", total=None)
                    result = processor.process_file_sync(audio_file)
                
                # Salvar resultado
                output_file_path = output_path / audio_file.stem
                save_results(result, output_file_path, format_type)
                
                if not quiet:
                    display_transcription_summary(result)
                
                successful_files += 1
                
            except Exception as e:
                console.print(f"❌ Erro ao processar {audio_file.name}: {str(e)}", style="red")
                if verbose:
                    console.print_exception()
                continue
    
    # Resumo final
    total_time = time.time() - total_start_time
    
    if not quiet:
        console.print("\n" + "="*60)
        
        summary_table = Table(title="📋 Resumo do Processamento")
        summary_table.add_column("Métrica", style="cyan")
        summary_table.add_column("Valor", style="green")
        
        summary_table.add_row("Arquivos Processados", f"{successful_files}/{len(audio_files)}")
        summary_table.add_row("Tempo Total", format_duration(total_time))
        summary_table.add_row("Formato de Saída", format_type.upper())
        summary_table.add_row("Modelo Usado", model)
        
        console.print(summary_table)
        
        if successful_files == len(audio_files):
            console.print("🎉 Todos os arquivos processados com sucesso!", style="bold green")
        else:
            failed = len(audio_files) - successful_files
            console.print(f"⚠️ {failed} arquivo(s) falharam no processamento", style="yellow")


@app.command()
def test():
    """🧪 Testa a configuração do sistema."""
    console.print("🧪 Testando configuração do sistema...\n", style="bold blue")
    
    # Testar importações
    try:
        from stt_processor import STTProcessor, STTConfig
        console.print("✅ Módulos STT carregados", style="green")
    except ImportError as e:
        console.print(f"❌ Erro ao importar módulos: {e}", style="red")
        raise typer.Exit(1)
    
    # Testar configuração
    try:
        config = STTConfig()
        console.print("✅ Configuração inicializada", style="green")
        console.print(f"   Dispositivo: {config.get_device()}", style="dim")
        console.print(f"   Modelo: {config.whisper_model}", style="dim")
    except Exception as e:
        console.print(f"❌ Erro na configuração: {e}", style="red")
        raise typer.Exit(1)
    
    # Testar GPU
    import torch
    if torch.cuda.is_available():
        console.print(f"✅ GPU disponível: {torch.cuda.get_device_name()}", style="green")
    else:
        console.print("⚠️ GPU não disponível - usando CPU", style="yellow")
    
    console.print("\n🎉 Sistema configurado corretamente!", style="bold green")


if __name__ == "__main__":
    app()