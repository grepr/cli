#!/bin/bash

# create-distributions.sh - Create customer distributions for Grepr CLI (consolidated script)

set -e

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$CLI_DIR/build/customer-distributions"
TEMPLATES_DIR="$CLI_DIR/templates"

# Source shared utilities
source "$SCRIPT_DIR/distribution-utils.sh"

echo -e "${GREEN}Creating Grepr CLI Customer Distributions...${NC}"

# Clean and create distribution directory
echo -e "${YELLOW}Cleaning distribution directory...${NC}"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Get version info
get_version_info "$CLI_DIR"
echo -e "${BLUE}Building version: $VERSION (commit: $COMMIT)${NC}"

# Build the CLI first
build_cli "$CLI_DIR"

# ===== CREATE SOURCE DISTRIBUTION =====

echo -e "${GREEN}Creating source distribution...${NC}"
SOURCE_DIR="$DIST_DIR/grepr-source-v$VERSION"
mkdir -p "$SOURCE_DIR/src/main"

# Copy source files. Tests are internal-only (they run under bun, which we do
# not require customers to install), so the source distribution ships only the
# production source and builds with plain `npm install && npm run build`.
echo -e "${YELLOW}Copying source files...${NC}"
cp -r "$CLI_DIR/src/main/typescript" "$SOURCE_DIR/src/main"
cp -r "$CLI_DIR/templates" "$SOURCE_DIR/"
cp -r "$CLI_DIR/scripts" "$SOURCE_DIR/"
cp "$CLI_DIR/tsconfig.json" "$SOURCE_DIR/"
cp "$CLI_DIR/eslint.config.mjs" "$SOURCE_DIR/"

# The source distribution must contain the inputs required by its own build.
DOCS_SOURCE_DIR="$CLI_DIR/docs-index-source"
if [ ! -d "$DOCS_SOURCE_DIR" ]; then
    DOCS_SOURCE_DIR="$CLI_DIR/../docs"
fi
if [ ! -d "$DOCS_SOURCE_DIR/app" ] || [ ! -d "$DOCS_SOURCE_DIR/components" ] || [ ! -f "$DOCS_SOURCE_DIR/public/openapi.json" ]; then
    echo -e "${RED}Documentation build inputs not found at $DOCS_SOURCE_DIR${NC}"
    exit 1
fi
mkdir -p "$SOURCE_DIR/docs-index-source/public"
cp -r "$DOCS_SOURCE_DIR/app" "$SOURCE_DIR/docs-index-source/"
cp -r "$DOCS_SOURCE_DIR/components" "$SOURCE_DIR/docs-index-source/"
cp "$DOCS_SOURCE_DIR/public/openapi.json" "$SOURCE_DIR/docs-index-source/public/"
rm -rf "$SOURCE_DIR/docs-index-source/app/release-notes"

# Generate package.json from main package.json
generate_source_package_json "$CLI_DIR" "$SOURCE_DIR"

# Copy README and other files
copy_readme "$CLI_DIR" "$SOURCE_DIR" "source"
copy_install_script "$TEMPLATES_DIR" "$SOURCE_DIR"
copy_license "$CLI_DIR" "$SOURCE_DIR"
create_version_file "$SOURCE_DIR" "Grepr CLI Source"

# Create BUILD.md if it doesn't exist
if [ ! -f "$CLI_DIR/BUILD.md" ]; then
    echo -e "${YELLOW}Creating BUILD.md...${NC}"
    cat > "$SOURCE_DIR/BUILD.md" << 'EOF'
# Building Grepr CLI from Source

## Prerequisites

- **Node.js 20.0.0 or higher** - [Download here](https://nodejs.org/)
- **npm or yarn** - Usually comes with Node.js
- **TypeScript** - Installed automatically as dev dependency

## Build Instructions

```bash
# Install dependencies
npm install
# or
yarn install

# Build the CLI
npm run build
# or
yarn build

# Test the build
./build/dist/grepr.js --help
```

## Installation Options

### Global Installation (Recommended)

```bash
# After building
npm install -g .
# or
yarn global add .

# Now you can use the CLI from anywhere
grepr --help
```

### Local Development

```bash
# Run directly from build directory
./build/dist/grepr.js --help

# Or create a symlink for development
npm link
# Now 'grepr' command is available globally for testing
```
EOF
else
    cp "$CLI_DIR/BUILD.md" "$SOURCE_DIR/"
fi

# Create source tarball
create_tarball "$DIST_DIR" "$SOURCE_DIR" "grepr-source-v$VERSION.tar.gz"

# ===== CREATE BINARY DISTRIBUTION =====

echo -e "${GREEN}Creating binary distribution...${NC}"
BINARY_DIR="$DIST_DIR/grepr-v$VERSION"
mkdir -p "$BINARY_DIR"

# Copy built files
echo -e "${YELLOW}Copying built files...${NC}"
cp -r "$CLI_DIR/build/dist/"* "$BINARY_DIR/"
chmod +x "$BINARY_DIR/grepr.js"

# Copy templates if they exist
if [ -d "$CLI_DIR/templates" ]; then
    echo -e "${YELLOW}Copying templates...${NC}"
    cp -r "$CLI_DIR/templates" "$BINARY_DIR/"
fi

# Generate package.json from main package.json
generate_binary_package_json "$CLI_DIR" "$BINARY_DIR"

# Copy README and other files
copy_readme "$CLI_DIR" "$BINARY_DIR" "binary"
copy_install_script "$TEMPLATES_DIR" "$BINARY_DIR"
copy_bin_wrapper "$TEMPLATES_DIR" "$BINARY_DIR"
copy_license "$CLI_DIR" "$BINARY_DIR"
create_version_file "$BINARY_DIR" "Grepr CLI"

# Create binary tarball
create_tarball "$DIST_DIR" "$BINARY_DIR" "grepr-v$VERSION.tar.gz"

# ===== SUMMARY =====

echo -e "${GREEN}Customer distributions created successfully!${NC}"
echo ""
echo -e "${BLUE}Distribution Summary:${NC}"
echo "  Version: $VERSION"
echo "  Build: $COMMIT"
echo "  Location: $DIST_DIR"
echo ""
echo -e "${GREEN}Files created:${NC}"
ls -la "$DIST_DIR"
echo ""

echo -e "${YELLOW}=== SOURCE DISTRIBUTION ====${NC}"
echo "File: grepr-source-v$VERSION.tar.gz"
echo "Contains: TypeScript source code, build scripts, templates"
echo "Usage: Extract, run 'npm install && npm run build', then install globally or run locally"
echo ""

echo -e "${YELLOW}=== BINARY DISTRIBUTION ====${NC}"
echo "File: grepr-v$VERSION.tar.gz"
echo "Contains: Pre-built JavaScript, install script, templates"
echo "Usage: Extract and run './install.sh' for global installation"
echo "   Or: Extract, run 'npm install', then use './grepr.js' directly"
echo ""

echo -e "${GREEN}Customer instructions:${NC}"
echo ""
echo -e "${BLUE}For Source Distribution:${NC}"
echo "  tar -xzf grepr-source-v$VERSION.tar.gz"
echo "  cd grepr-source-v$VERSION"
echo "  npm install && npm run build"
echo "  npm install -g .  # Global install"
echo "  grepr --help"
echo ""
echo -e "${BLUE}For Binary Distribution:${NC}"
echo "  tar -xzf grepr-v$VERSION.tar.gz"
echo "  cd grepr-v$VERSION"
echo "  sudo ./install.sh  # Global install"
echo "  grepr --help"
echo ""
echo "Both distributions include complete README files with detailed installation and usage instructions."
