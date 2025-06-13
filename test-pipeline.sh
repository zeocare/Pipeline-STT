#!/bin/bash

# STT Pipeline - End-to-End Testing Script
# This script tests the complete pipeline with a sample audio file

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
UPLOAD_WORKER_URL="https://stt-upload-processor.voitherbrazil.workers.dev"
TRANSCRIPTION_WORKER_URL="https://stt-transcription-engine.voitherbrazil.workers.dev"
ASSEMBLY_WORKER_URL="https://stt-assembly-ner.voitherbrazil.workers.dev"
CLIENT_API_KEY="${CLIENT_API_KEY:-test-client-key-123}"

echo -e "${BLUE}🧪 STT Pipeline End-to-End Test${NC}"
echo "================================================"

# Function to check if a URL is accessible
check_health() {
    local service_name=$1
    local url=$2
    
    echo -n "Testing ${service_name}... "
    if curl -s -f "${url}/health" > /dev/null; then
        echo -e "${GREEN}✅ Healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ Not accessible${NC}"
        return 1
    fi
}

# Function to wait with a spinner
wait_with_spinner() {
    local duration=$1
    local message=$2
    
    echo -n "${message}"
    for ((i=1; i<=duration; i++)); do
        printf "."
        sleep 1
    done
    echo ""
}

# Health checks
echo -e "${YELLOW}🔍 Checking service health...${NC}"
check_health "Upload Processor" "$UPLOAD_WORKER_URL"
check_health "Transcription Engine" "$TRANSCRIPTION_WORKER_URL"
check_health "Assembly NER" "$ASSEMBLY_WORKER_URL"
echo ""

# Create test audio file if it doesn't exist
TEST_AUDIO_FILE="test-audio.mp3"
if [[ ! -f "$TEST_AUDIO_FILE" ]]; then
    echo -e "${YELLOW}📁 Creating test audio file...${NC}"
    # Create a simple sine wave test audio (requires ffmpeg)
    if command -v ffmpeg &> /dev/null; then
        ffmpeg -f lavfi -i "sine=frequency=440:duration=10" -acodec mp3 -b:a 128k "$TEST_AUDIO_FILE" -y -loglevel quiet
        echo -e "${GREEN}✅ Test audio file created (10 seconds, 440Hz tone)${NC}"
    else
        echo -e "${RED}❌ ffmpeg not found. Please provide a test MP3 file named 'test-audio.mp3'${NC}"
        echo "You can download a sample file or record a short audio clip."
        exit 1
    fi
    echo ""
fi

# Test file upload and processing
echo -e "${YELLOW}🚀 Starting pipeline test...${NC}"
echo "Uploading: $TEST_AUDIO_FILE"

# Upload audio file
echo -n "Uploading audio file... "
UPLOAD_RESPONSE=$(curl -s -X POST "$UPLOAD_WORKER_URL/upload" \
    -H "X-API-Key: $CLIENT_API_KEY" \
    -F "audio=@$TEST_AUDIO_FILE" \
    -F 'options={"language":"pt","speakers":2,"format":"json","enhancedAccuracy":true}')

if echo "$UPLOAD_RESPONSE" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Success${NC}"
    JOB_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"jobId":"[^"]*"' | sed 's/"jobId":"//;s/"//')
    echo "Job ID: $JOB_ID"
    
    # Extract other info from response
    CHUNKS=$(echo "$UPLOAD_RESPONSE" | grep -o '"chunks":[0-9]*' | sed 's/"chunks"://')
    ESTIMATED_TIME=$(echo "$UPLOAD_RESPONSE" | grep -o '"estimatedTime":[0-9]*' | sed 's/"estimatedTime"://')
    
    echo "Chunks created: $CHUNKS"
    echo "Estimated time: ${ESTIMATED_TIME}s"
else
    echo -e "${RED}❌ Failed${NC}"
    echo "Response: $UPLOAD_RESPONSE"
    exit 1
fi
echo ""

# Monitor job progress
echo -e "${YELLOW}📊 Monitoring job progress...${NC}"
MAX_WAIT_TIME=300  # 5 minutes
WAIT_INTERVAL=10   # Check every 10 seconds
elapsed_time=0

while [[ $elapsed_time -lt $MAX_WAIT_TIME ]]; do
    # Check job status
    STATUS_RESPONSE=$(curl -s "$UPLOAD_WORKER_URL/status/$JOB_ID")
    
    if echo "$STATUS_RESPONSE" | grep -q '"success":true'; then
        JOB_STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | sed 's/"status":"//;s/"//')
        PROGRESS=$(echo "$STATUS_RESPONSE" | grep -o '"progress":[0-9]*' | sed 's/"progress"://')
        
        echo "Status: $JOB_STATUS | Progress: ${PROGRESS}%"
        
        # Check if completed
        if [[ "$JOB_STATUS" == "completed" ]]; then
            echo -e "${GREEN}🎉 Job completed successfully!${NC}"
            break
        elif [[ "$JOB_STATUS" == "failed" ]]; then
            ERROR=$(echo "$STATUS_RESPONSE" | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"//')
            echo -e "${RED}❌ Job failed: $ERROR${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Failed to get job status${NC}"
        echo "Response: $STATUS_RESPONSE"
        exit 1
    fi
    
    # Wait before next check
    wait_with_spinner $WAIT_INTERVAL "Waiting ${WAIT_INTERVAL}s for next update"
    elapsed_time=$((elapsed_time + WAIT_INTERVAL))
done

if [[ $elapsed_time -ge $MAX_WAIT_TIME ]]; then
    echo -e "${RED}⏰ Job did not complete within ${MAX_WAIT_TIME}s${NC}"
    exit 1
fi

# Get final results
echo ""
echo -e "${YELLOW}📋 Retrieving final results...${NC}"
RESULTS_RESPONSE=$(curl -s "$ASSEMBLY_WORKER_URL/results/$JOB_ID")

if echo "$RESULTS_RESPONSE" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Results retrieved successfully${NC}"
    
    # Extract key metrics
    echo ""
    echo -e "${BLUE}📊 Results Summary:${NC}"
    echo "============================================"
    
    # Save full results to file
    echo "$RESULTS_RESPONSE" | python3 -m json.tool > "results_$JOB_ID.json" 2>/dev/null || echo "$RESULTS_RESPONSE" > "results_$JOB_ID.json"
    echo "Full results saved to: results_$JOB_ID.json"
    
    # Extract and display key information
    if command -v jq &> /dev/null; then
        echo ""
        echo "Speakers detected: $(echo "$RESULTS_RESPONSE" | jq -r '.results.transcript.speakers | length // "N/A"')"
        echo "Total segments: $(echo "$RESULTS_RESPONSE" | jq -r '.results.transcript.segments | length // "N/A"')"
        echo "Word count: $(echo "$RESULTS_RESPONSE" | jq -r '.results.processing.word_count // "N/A"')"
        echo "Confidence: $(echo "$RESULTS_RESPONSE" | jq -r '.results.processing.confidence // "N/A"')"
        echo "Medical entities found: $(echo "$RESULTS_RESPONSE" | jq -r '.results.entity_counts.total_entities // "N/A"')"
        echo ""
        echo "Download URLs:"
        echo "- JSON: $(echo "$RESULTS_RESPONSE" | jq -r '.results.downloadUrls.json // "N/A"')"
        echo "- TXT: $(echo "$RESULTS_RESPONSE" | jq -r '.results.downloadUrls.txt // "N/A"')"
        echo "- SRT: $(echo "$RESULTS_RESPONSE" | jq -r '.results.downloadUrls.srt // "N/A"')"
        echo "- Medical JSON: $(echo "$RESULTS_RESPONSE" | jq -r '.results.downloadUrls.medical_json // "N/A"')"
    else
        echo "Install 'jq' for formatted output: sudo apt-get install jq"
    fi
    
else
    echo -e "${RED}❌ Failed to retrieve results${NC}"
    echo "Response: $RESULTS_RESPONSE"
    exit 1
fi

# Test download functionality
echo ""
echo -e "${YELLOW}💾 Testing download functionality...${NC}"

for format in json txt srt medical_json; do
    echo -n "Downloading $format format... "
    if curl -s -f "$ASSEMBLY_WORKER_URL/download/$JOB_ID/$format" -o "test_result.$format"; then
        echo -e "${GREEN}✅ Success${NC}"
        FILE_SIZE=$(wc -c < "test_result.$format")
        echo "  File size: ${FILE_SIZE} bytes"
    else
        echo -e "${RED}❌ Failed${NC}"
    fi
done

echo ""
echo "============================================"
echo -e "${GREEN}🎉 Pipeline test completed successfully!${NC}"
echo ""
echo "Test files created:"
echo "- test-audio.mp3 (input audio)"
echo "- results_$JOB_ID.json (full results)"
echo "- test_result.* (downloaded formats)"
echo ""
echo "Next steps:"
echo "1. Review the generated transcription"
echo "2. Verify medical entities were extracted correctly"
echo "3. Test with your own audio files"
echo "4. Set up monitoring and alerting"
echo ""
echo -e "${BLUE}Happy transcribing! 🎤➡️📝${NC}"