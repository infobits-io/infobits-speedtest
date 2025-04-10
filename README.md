# InfoBits Speed Test

A modern internet speed test application built with Next.js, TypeScript, and CSS modules.

## Features

- Download speed measurement
- Upload speed measurement
- Latency (ping) testing
- Jitter measurement
- Responsive design
- Real-time progress indicators

## GitHub Container Registry

This project uses GitHub Actions to automatically build and publish Docker images to GitHub Container Registry.

### Using the pre-built image

```bash
# Pull the latest image
docker pull ghcr.io/infobits-io/infobits-speedtest:latest

# Run the container
docker run -p 3000:3000 ghcr.io/infobits-io/infobits-speedtest:latest
```

Or in a docker-compose.yml file:

```yaml
version: '3'

services:
  speedtest:
    image: ghcr.io/infobits-io/infobits-speedtest:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```

## Docker Setup (Local Build)

### Using Docker Compose

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Build and start the container:
   ```bash
   docker-compose up -d
   ```

3. Access the application at `http://localhost:3000`

### Manual Docker Build

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Build the Docker image:
   ```bash
   docker build -t infobits-speedtest .
   ```

3. Run the container:
   ```bash
   docker run -p 3000:3000 infobits-speedtest
   ```

4. Access the application at `http://localhost:3000`

## Development Setup

### Prerequisites

- Node.js 18.x or later
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. Access the application at `http://localhost:3000`

## Building for Production

```bash
npm run build
npm start
```

## CI/CD Workflow

This project includes a GitHub Actions workflow that:
- Builds the Docker image on every push to main/master
- Pushes the image to GitHub Container Registry
- Creates version tags when you push version tags (e.g., v1.0.0)

The workflow file is located at `.github/workflows/docker-publish.yml`.

## Tech Stack

- Next.js 14 with App Router
- TypeScript
- CSS Modules
- React
- Docker
- GitHub Actions

## License

MIT