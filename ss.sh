#!/bin/bash

echo "==============================================="
echo "Starting Claude Code CLI via AgentRouter..."
echo "==============================================="

export ANTHROPIC_API_KEY="sk-bHoou0Gmx6zm0fZVke1MEaDvxYVEFOr6z0XPELAvARG9fXBj"
export ANTHROPIC_BASE_URL="https://agentrouter.org"

# Do NOT force a specific Claude model here.
unset ANTHROPIC_MODEL

claude