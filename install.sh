#!/bin/bash

# art0 · 8disks - Local Development Server
# Finds available port, starts server, opens browser

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}art0 · 8disks${NC}"
echo ""

# Find available port starting from 8080
find_port() {
    local port=8080
    while lsof -i :$port >/dev/null 2>&1; do
        ((port++))
        if [ $port -gt 9000 ]; then
            echo "No available ports found between 8080-9000"
            exit 1
        fi
    done
    echo $port
}

PORT=$(find_port)
URL="http://localhost:$PORT"

echo -e "Starting server on port ${GREEN}$PORT${NC}..."
echo ""

# Detect OS for open command
open_browser() {
    sleep 1
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$URL"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$URL" 2>/dev/null || echo "Open $URL in your browser"
    else
        echo "Open $URL in your browser"
    fi
}

# Try Python first (most common on macOS/Linux)
if command -v python3 &>/dev/null; then
    echo -e "${GREEN}Using Python 3${NC}"
    echo -e "Server: ${CYAN}$URL${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
    echo ""
    open_browser &
    python3 -m http.server $PORT

# Try Python 2 fallback
elif command -v python &>/dev/null; then
    echo -e "${GREEN}Using Python${NC}"
    echo -e "Server: ${CYAN}$URL${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
    echo ""
    open_browser &
    python -m SimpleHTTPServer $PORT

# Try Node.js npx serve
elif command -v npx &>/dev/null; then
    echo -e "${GREEN}Using npx serve${NC}"
    echo -e "Server: ${CYAN}$URL${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
    echo ""
    open_browser &
    npx serve -p $PORT

# Try PHP built-in server
elif command -v php &>/dev/null; then
    echo -e "${GREEN}Using PHP${NC}"
    echo -e "Server: ${CYAN}$URL${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
    echo ""
    open_browser &
    php -S localhost:$PORT

else
    echo "Error: No suitable server found."
    echo ""
    echo "Install one of the following:"
    echo "  - Python 3: brew install python3"
    echo "  - Node.js:  brew install node"
    echo "  - PHP:      brew install php"
    exit 1
fi
