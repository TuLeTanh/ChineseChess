# Custom Sound Overrides (`assets/sounds/`)

By default, the app synthesizes all 9 sound effects offline using the Web Audio API (`js/audio/synth.js`), so no audio files are required.

To override any synthesized sound with your own recording, place a file named `<event>.ogg`, `<event>.mp3`, or `<event>.wav` directly in this folder (`assets/sounds/`):

- `select` — picking up a piece
- `move` — wooden piece landing on the board
- `capture` — heavier wooden capture clack
- `check` — bronze gong ("Chiếu tướng!")
- `checkmate` — low gong + pentatonic arpeggio ("Chiếu bí!")
- `start` — calm gong + 3-note motif on New Game
- `illegal` — muted rejection tock
- `draw` — two soft gong strokes
- `undo` — soft undo click

When served via `python -m http.server`, the app automatically detects files in `assets/sounds/` and loads them in place of the synthesized buffers.

## Safe Free Audio Sources
If you want real acoustic recordings without licensing issues, use **CC0 (Public Domain)** sources such as:
- [Freesound.org](https://freesound.org/) filtered by **Creative Commons 0 (CC0)** license
- [Kenney.nl](https://kenney.nl/assets) audio packs (CC0)

## Mẹo thay tiếng gỗ thật (Tiếng Việt)
Nếu bạn muốn tiếng đặt quân / ăn quân nghe giống gỗ thật hơn nữa so với bản tổng hợp, chỉ cần tải một file thu âm CC0 (từ khóa `"wood clack"` hoặc `"chess piece"` trên Freesound.org lọc giấy phép CC0 / Kenney.nl) rồi lưu đè vào thư mục này với tên `assets/sounds/move.wav` và `assets/sounds/capture.wav` — trò chơi sẽ tự động nhận diện và dùng ngay.
