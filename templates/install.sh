#!/bin/bash

# install.sh - Install Grepr CLI with dependencies

set -e

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required but not installed."
    echo "Please install Node.js 20.0.0 or higher from https://nodejs.org/"
    exit 1
fi

# Check for npm or yarn
if ! command -v npm &> /dev/null && ! command -v yarn &> /dev/null; then
    echo "Error: npm or yarn is required but not installed."
    exit 1
fi

# Default install location
INSTALL_DIR="/usr/local/lib/grepr-cli"
BIN_DIR="/usr/local/bin"
SCRIPT_NAME="grepr"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            INSTALL_DIR="$2"
            BIN_DIR="$2"
            shift 2
            ;;
        --name)
            SCRIPT_NAME="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--install-dir DIR] [--name NAME]"
            echo ""
            echo "Options:"
            echo "  --install-dir DIR   Installation directory (default: /usr/local/lib/grepr-cli)"
            echo "  --name NAME         Script name (default: grepr)"
            echo "  -h, --help          Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if install directory is writable
if [ ! -w "$(dirname "$INSTALL_DIR")" ]; then
    echo "Error: No write permission to $(dirname "$INSTALL_DIR")"
    echo "Try running with sudo"
    exit 1
fi

# Create installation directory
echo "Installing Grepr CLI to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

# Copy all files
cp -r * "$INSTALL_DIR/"

# Install dependencies
cd "$INSTALL_DIR"
if command -v yarn &> /dev/null; then
    echo "Installing dependencies with yarn..."
    yarn install --production --frozen-lockfile
else
    echo "Installing dependencies with npm..."
    npm install --production
fi

# Create shell wrapper in bin directory
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/$SCRIPT_NAME" << EOF
#!/usr/bin/env sh
exec node "$INSTALL_DIR/grepr.js" "\$@"
EOF
chmod +x "$BIN_DIR/$SCRIPT_NAME"

echo "Installation complete!"
echo ""
echo "You can now run: $SCRIPT_NAME --help"
echo ""
echo "To uninstall, run:"
echo "  rm -rf $INSTALL_DIR"
echo "  rm $BIN_DIR/$SCRIPT_NAME"