# Workout Analyser 🐉

A web-based telemetry and performance analyser for dragon boat racing, interval training, and multi-boat comparative benchmarking.

🔗 **GitHub Repository**: [https://github.com/johnnyyuen/workout-analyser](https://github.com/johnnyyuen/workout-analyser)

---

## Features

### 1. Interval & Repeat Analyser (`workout.html`)
- **Single GPX Workout Telemetry**: Input a single activity file with repeated back-and-forth efforts.
- **Reference Course Normalization**: Automatically aligns workout coordinates to a reference route (`routes/rroute_*.gpx`).
- **Lap Segmentation**: Automatically detects Outbound (A ➔ B) and Return (B ➔ A) efforts with 100m split times.
- **Telemetry Overlay**: Interactive Leaflet map with Carto basemaps and interactive telemetry charts (Speed, Heart Rate, Split Pace, Stroke Cadence).
- **Settings Drawer**: Manage reference courses, upload custom GPX tracks, scan local directories, or fetch from the server.
- **CSV Export**: One-click download of all lap splits and metrics.

### 2. Multiple GPX Analyser (`index.html`)
- **Multi-Boat Telemetry Comparison**: Upload and align multiple GPX files concurrently against a reference course (`routes/mroute_*.gpx`).
- **Course Gates & Normalized Distance**: Projects boat tracks orthogonally onto the reference course polyline from Gate A to Gate B (no distance guessing).
- **Ranked Splits Leaderboard**: Calculates 5 proportional checkpoint splits (e.g. 0-100m, 100-200m, 200-300m, 300-400m, 400-500m) with fastest splits highlighted in green.
- **Synchronized Charts**: Speed (km/h), Pace (/500m), Heart Rate (bpm), and Stroke Rate (SPM) interpolated across distance.
- **Interactive Map**: Multi-color boat tracks with start/finish gates and instant track toggle badges.

---

## Directory Structure

```text
workout-analyser/
├── index.html            # Multiple GPX Comparison page
├── workout.html          # Interval & Repeat Analyser page
├── css/
│   └── style.css         # Styling and UI overrides
├── js/
│   ├── multiple.js       # Multi-boat telemetry & alignment engine
│   ├── workout.js        # Interval segmentation & lap engine
│   └── app.js            # Shared utility logic
├── routes/               # Reference course tracks and manifests
│   ├── mroute_*.gpx      # Reference routes for Multiple comparison
│   ├── rroute_*.gpx      # Reference routes for Interval repeats
│   ├── mroutes.json      # Index manifest of multiple routes
│   ├── rroutes.json      # Index manifest of interval routes
│   └── routes.json       # Combined manifest
├── sample_data/          # Sample GPX workouts and races for demo
├── LICENSE               # GNU General Public License v3
└── README.md             # Documentation
```

---

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
