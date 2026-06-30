#!/bin/bash

# distribution-utils.sh - Shared utilities for CLI distribution scripts

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get version information
get_version_info() {
    local cli_dir="$1"
    VERSION=$(node -e "console.log(require('$cli_dir/package.json').version)")
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    DATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
}

# Create version file
create_version_file() {
    local target_dir="$1"
    local prefix="$2"

    cat > "$target_dir/VERSION" << EOF
$prefix v$VERSION
Build: $COMMIT
Date: $DATE
EOF
}

# Substitute variables in template file
substitute_template() {
    local template_file="$1"
    local output_file="$2"

    # Use envsubst to substitute environment variables
    export VERSION COMMIT DATE
    envsubst < "$template_file" > "$output_file"
}

# Copy install script from template
copy_install_script() {
    local templates_dir="$1"
    local target_dir="$2"

    cp "$templates_dir/install.sh" "$target_dir/install.sh"
    chmod +x "$target_dir/install.sh"
}

# Copy README from existing file and add distribution-specific instructions
copy_readme() {
    local cli_dir="$1"
    local target_dir="$2"
    local distribution_type="${3:-binary}"  # binary or source

    if [ -f "$cli_dir/README.md" ]; then
        # Copy the base README
        cp "$cli_dir/README.md" "$target_dir/README.md"

        # Add distribution-specific installation instructions
        if [ "$distribution_type" = "binary" ]; then
            cat >> "$target_dir/README.md" << 'EOF'

## Distribution Installation

This is a pre-built binary distribution. You have several installation options:

### Method 1: Global Installation (Recommended)

```bash
# Extract the archive
tar -xzf grepr-v*.tar.gz
cd grepr-v*

# Install globally using the provided script
sudo ./install.sh

# Verify installation
grepr --help
```

### Method 2: Direct Usage

```bash
# Extract the archive
tar -xzf grepr-v*.tar.gz
cd grepr-v*

# Install dependencies
npm install

# Use the CLI directly
./grepr.js --help
```

### Method 3: Manual npm Installation

```bash
# Extract and install as an npm package
tar -xzf grepr-v*.tar.gz
cd grepr-v*
npm install -g .
```
EOF
        elif [ "$distribution_type" = "source" ]; then
            cat >> "$target_dir/README.md" << 'EOF'

## Source Distribution Installation

This is a source code distribution that requires building before use:

### Build and Install

```bash
# Extract the archive
tar -xzf grepr-source-v*.tar.gz
cd grepr-source-v*

# Install dependencies and build
npm install
npm run build

# Install globally (recommended)
npm install -g .

# Or use directly from build directory
./build/dist/grepr.js --help
```

See BUILD.md for detailed build instructions and development setup.
EOF
        fi
    else
        echo -e "${RED}Error: README.md not found${NC}"
        exit 1
    fi
}

# Copy bin wrapper script
copy_bin_wrapper() {
    local templates_dir="$1"
    local target_dir="$2"

    mkdir -p "$target_dir/bin"
    cp "$templates_dir/bin-wrapper" "$target_dir/bin/grepr"
    chmod +x "$target_dir/bin/grepr"
}

# Copy LICENSE file with current year substitution
copy_license() {
    local cli_dir="$1"
    local target_dir="$2"

    if [ -f "$cli_dir/LICENSE" ]; then
        local current_year=$(date +"%Y")
        sed "s/\[year\]/$current_year/g" "$cli_dir/LICENSE" > "$target_dir/LICENSE"
    else
        echo -e "${RED}Warning: LICENSE file not found${NC}"
    fi
}

# Build CLI from source
build_cli() {
    local cli_dir="$1"

    echo -e "${YELLOW}Building CLI...${NC}"
    cd "$cli_dir"
    bun install --frozen-lockfile
    bun run build
}

# Create tarball
create_tarball() {
    local base_dir="$1"
    local source_dir="$2"
    local tarball_name="$3"

    echo -e "${YELLOW}Creating tarball: $tarball_name${NC}"
    cd "$base_dir"
    tar -czf "$tarball_name" -C "$(dirname "$source_dir")" "$(basename "$source_dir")"
}

# Extract tarball for testing
extract_tarball() {
    local tarball_path="$1"
    local extract_dir="$2"

    mkdir -p "$extract_dir"
    cd "$extract_dir"
    tar -xzf "$tarball_path"
    echo "Extracted $tarball_path to $extract_dir"
}

# Generate package.json for binary distribution from main package.json
generate_binary_package_json() {
    local cli_dir="$1"
    local target_dir="$2"

    echo -e "${YELLOW}Generating binary package.json from main package.json...${NC}"

    # Read the main package.json and modify it using node
    node -e "
        const fs = require('fs');
        const path = require('path');
        const pkg = JSON.parse(fs.readFileSync('$cli_dir/package.json', 'utf8'));

        // Modify for binary distribution
        pkg.name = 'grepr';
        pkg.version = '$VERSION';
        pkg.main = 'grepr.js';
        delete pkg.devDependencies;
        delete pkg.scripts;
        delete pkg.publishConfig;

        // Update bin to point to wrapper script
        pkg.bin = { grepr: './bin/grepr' };

        // Dynamically generate files array based on what's actually in the target directory
        const files = new Set();

        // Always include these core files
        files.add('README.md');
        files.add('LICENSE');
        files.add('package.json');

        // Add all top-level JS/TS files and source maps
        const topLevelFiles = fs.readdirSync('$target_dir');
        topLevelFiles.forEach(file => {
            if (file.match(/\\.(js|d\\.ts|js\\.map|d\\.ts\\.map)$/)) {
                files.add(file);
            }
        });

        // Add all directories (they will include their contents automatically with /**/* pattern)
        topLevelFiles.forEach(item => {
            const itemPath = path.join('$target_dir', item);
            if (fs.statSync(itemPath).isDirectory()) {
                files.add(item + '/**/*');
            }
        });

        // Convert Set to sorted array for consistent output
        pkg.files = Array.from(files).sort();

        fs.writeFileSync('$target_dir/package.json', JSON.stringify(pkg, null, 2));

        // Log what files will be included for debugging
        console.log('Binary distribution files array:', pkg.files);
    "
}

# Generate package.json for source distribution from main package.json
generate_source_package_json() {
    local cli_dir="$1"
    local target_dir="$2"

    echo -e "${YELLOW}Generating source package.json from main package.json...${NC}"

    # Read the main package.json and modify it using node
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$cli_dir/package.json', 'utf8'));

        // Modify for source distribution
        pkg.name = 'grepr';
        pkg.version = '$VERSION';
        delete pkg.publishConfig;

        // Update files array for source distribution
        pkg.files = ['build/dist/**/*', 'templates/**/*', 'README.md', 'LICENSE'];

        fs.writeFileSync('$target_dir/package.json', JSON.stringify(pkg, null, 2));
    "
}