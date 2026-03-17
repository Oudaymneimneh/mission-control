#!/bin/bash
# Seed 4 agents with Big Five personality traits for meeting demos.
# Usage: bash scripts/seed-meeting-agents.sh

BASE="http://localhost:4000"
API_KEY="f9016aa097f8c943f909464ba4ee858185733715fa641eb6672bc05b8212ec2d"

echo "Creating agents with persona configs..."

# 1. Atlas — extraverted engineer, high meeting propensity
curl -s -X POST "$BASE/api/agents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Atlas",
    "role": "Senior Engineer",
    "status": "idle",
    "config": {
      "persona": {
        "personality": {
          "extraversion": 0.85,
          "agreeableness": 0.7,
          "openness": 0.75,
          "conscientiousness": 0.6,
          "neuroticism": 0.2
        }
      }
    }
  }' | jq .
echo ""

# 2. Nova — creative designer, moderate meeting propensity
curl -s -X POST "$BASE/api/agents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Nova",
    "role": "UX Designer",
    "status": "idle",
    "config": {
      "persona": {
        "personality": {
          "extraversion": 0.6,
          "agreeableness": 0.8,
          "openness": 0.9,
          "conscientiousness": 0.5,
          "neuroticism": 0.3
        }
      }
    }
  }' | jq .
echo ""

# 3. Cipher — analytical PM, balanced propensity
curl -s -X POST "$BASE/api/agents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Cipher",
    "role": "Product Manager",
    "status": "idle",
    "config": {
      "persona": {
        "personality": {
          "extraversion": 0.7,
          "agreeableness": 0.65,
          "openness": 0.6,
          "conscientiousness": 0.85,
          "neuroticism": 0.25
        }
      }
    }
  }' | jq .
echo ""

# 4. Sage — introverted researcher, low meeting propensity
curl -s -X POST "$BASE/api/agents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Sage",
    "role": "Research Analyst",
    "status": "idle",
    "config": {
      "persona": {
        "personality": {
          "extraversion": 0.2,
          "agreeableness": 0.5,
          "openness": 0.8,
          "conscientiousness": 0.9,
          "neuroticism": 0.6
        }
      }
    }
  }' | jq .
echo ""

echo "Done! Agents created."
echo ""
echo "Expected meeting propensities:"
echo "  Atlas:  0.85*0.6 + 0.70*0.3 + 0.75*0.1 = 0.795 (HIGH - will seek meetings often)"
echo "  Nova:   0.60*0.6 + 0.80*0.3 + 0.90*0.1 = 0.690 (MEDIUM-HIGH)"
echo "  Cipher: 0.70*0.6 + 0.65*0.3 + 0.60*0.1 = 0.675 (MEDIUM-HIGH)"
echo "  Sage:   0.20*0.6 + 0.50*0.3 + 0.80*0.1 = 0.350 (AT THRESHOLD - rare meetings)"
echo ""
echo "Next steps:"
echo "  1. Start simulation:  curl -X POST $BASE/api/simulation/start -H 'x-api-key: $API_KEY'"
echo "  2. Open office panel:  open http://localhost:4000/office"
echo "  3. Watch meetings happen! Atlas and Nova will meet first (highest propensity + compatibility)"
echo "  4. Check meetings API: curl '$BASE/api/meetings' -H 'x-api-key: $API_KEY' | jq ."
