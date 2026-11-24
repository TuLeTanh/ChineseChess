# Luật chơi Cờ Úp (Jieqi / 揭棋)

> Tài liệu đối chiếu:
> - [ChessProgramming Wiki — Jeiqi](https://www.chessprogramming.org/Jeiqi)
> - [PyChess — Jieqi Variant Rules](https://www.pychess.org/variants/jieqi)

## 1. Bàn cờ & Bày quân ban đầu
- Dùng chung bàn cờ 9×10 giao điểm của Cờ Tướng.
- **Hai quân Tướng (`帥` / `將`)** được đặt **ngửa** ở vị trí xuất phát chuẩn (`e0` cho Đỏ, `e9` cho Đen).
- **15 quân còn lại của mỗi bên** (2 Xe, 2 Mã, 2 Tượng, 2 Sĩ, 2 Pháo, 5 Tốt) được **úp mặt xuống**, xáo trộn ngẫu nhiên đồng đều rồi đặt lên 15 vị trí xuất phát còn lại của bên đó.
- Đỏ đi trước. Không bên nào biết danh tính thật của các quân đang úp.

## 2. Quân úp (Covered piece)
- Khi còn úp, mỗi quân đứng tại ô xuất phát ban đầu và mang **loại giả định (fake type)** đúng bằng quân Cờ Tướng chuẩn ở ô đó (ví dụ: quân úp ở góc đi như Xe, ở ô Tượng đi như Tượng và không qua sông ở nước đầu, ở ô Sĩ chỉ đi chéo trong cung, ở ô Tốt chỉ đi thẳng 1 bước).
- Ngay sau khi quân úp thực hiện nước đi đầu tiên (kể cả khi ăn quân), nó được **lật ngửa** thành danh tính thật tại ô đích và từ đó về sau đi theo luật của quân thật.
- **Khi quân úp bị ăn**: theo cấu hình mặc định `REVEAL_ON_CAPTURE = true` (`js/variants/jieqi.js`), quân bị ăn được lật ngửa vào khay quân bị ăn và trừ khỏi bảng quân úp còn lại.

## 3. Luật đi của quân đã lật
Mọi quân đã lật đi giống Cờ Tướng truyền thống, **ngoại trừ 3 điểm đặc trưng của Cờ Úp**:
1. **Sĩ (`仕` / `士`)**: đi chéo 1 ô **khắp bàn cờ** (không bị giới hạn trong cung Cửu Cung).
2. **Tượng (`相` / `象`)**: đi chéo đúng 2 ô **khắp bàn cờ** và **được phép qua sông**, vẫn bị cản nếu mắt tượng có quân đứng.
3. **Tốt (`兵` / `卒`)**: đi thẳng 1 ô; khi sang phần sân đối phương (qua sông) thì được đi ngang 1 ô; không bao giờ đi lùi. Nếu Tốt được lật ở hàng cuối đối phương thì chỉ có thể đi ngang.
- Tướng vẫn ở trong cung; Xe, Mã (cản chân mã), Pháo (cần đúng 1 ngòi để ăn) giữ nguyên.

## 4. Chiếu, Tính hợp lệ & Kết thúc ván
- Quân úp của đối phương chiếu/tấn công theo **loại giả định** của nó.
- Nước đi hợp lệ khi và chỉ khi sau nước đi đó, Tướng mình không bị chiếu (kể cả luật **lộ mặt tướng**). Tính hợp lệ không bao giờ phụ thuộc vào danh tính ẩn của quân sắp đi.
- **Chiếu bí**: thắng. **Hết nước đi (bí nước / stalemate)**: bên không còn nước hợp lệ **thua**.
- **Hòa**: lặp thế cờ 3 lần hoặc 120 nửa nước (60 nước mỗi bên) không ăn quân.
- **Đi lại (Undo)**: chỉ cho phép ở chế độ **Hai người** (quân lùi về trạng thái úp nhưng giữ nguyên danh tính bí mật). Bị khóa ở chế độ **Đấu máy** và **Đấu online** để tránh lộ thông tin quân úp.
