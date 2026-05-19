default:
    @just --list

# Install dependencies
deps:
    pnpm install

# Build dmux (generates hooks docs, builds frontend, compiles TypeScript)
build: deps
    pnpm run build

# Build and install dmux globally via pnpm link
install: build
    pnpm link --global

# Remove the global dmux link
uninstall:
    pnpm uninstall --global dmux

# Clean build artifacts
clean:
    pnpm run clean
