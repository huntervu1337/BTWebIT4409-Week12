require("dotenv").config(); 

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// 1. KẾT NỐI MONGODB & ĐỊNH NGHĨA SCHEMA
// ==========================================

// Thay thế chuỗi kết nối bằng tài khoản / MSSV thực tế của bạn
const MONGODB_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB successfully!");
    seedMockData(); // Gọi hàm kiểm tra và seed dữ liệu sau khi kết nối thành công
  })
  .catch((err) => console.error("MongoDB Connection Error:", err));

// Schema bắt buộc theo tài liệu hướng dẫn
const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Tên không được để trống"],
    minlength: [2, "Tên phải có ít nhất 2 ký tự"],
    trim: true,
  },
  age: {
    type: Number,
    required: [true, "Tuổi không được để trống"],
    min: [0, "Tuổi phải >= 0"],
  },
  email: {
    type: String,
    required: [true, "Email không được để trống"],
    unique: true, // Đảm bảo email là duy nhất trong database theo yêu cầu bổ sung
    match: [/^\S+@\S+\.\S+$/, "Email không hợp lệ"],
    trim: true,
  },
  address: {
    type: String,
    required: false,
    trim: true,
  },
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

// ==========================================
// 2. HÀM TỰ ĐỘNG CHÈN MOCK DATA (MỚI)
// ==========================================
async function seedMockData() {
  try {
    const count = await User.countDocuments();
    
    // Nếu trong Database chưa có dữ liệu, tiến hành nạp data tự động
    if (count === 0) {
      console.log("Database đang trống! Đang nạp dữ liệu giả lập...");

      const mockUsersList = [
        // 1. Dữ liệu bản thân nằm ở vị trí đầu tiên
        {
          name: "Vũ Văn Phong", // Điền họ tên thật của bạn vào đây
          age: 21,
          email: "phongvanlongvu@gmail.com",
          address: "Hà Nội",
        },
        // 2. Dữ liệu thành viên nhóm BTL
        {
          name: "Nguyễn Văn Nhóm Trưởng",
          age: 22,
          email: "truongnhom@example.com",
          address: "Hải Phòng",
        },
        // 3. Dữ liệu các bạn ngồi xung quanh và các user test phân trang (15+ bản ghi)
        ...Array.from({ length: 15 }).map((_, index) => ({
          name: `Bạn ngồi cạnh ${index + 1}`,
          age: 20 + (index % 5),
          email: `bansinhvien${index + 1}@example.com`,
          address: index % 2 === 0 ? "Hà Nội" : "Đà Nẵng",
        }))
      ];

      await User.insertMany(mockUsersList);
      console.log(`Đã chèn thành công ${mockUsersList.length} người dùng vào MongoDB!`);
    } else {
      console.log(`Database đã có sẵn ${count} người dùng. Bỏ qua bước seed dữ liệu.`);
    }
  } catch (error) {
    console.error("Lỗi khi seed dữ liệu giả lập:", error.message);
  }
}

// ==========================================
// 3. CÁC API ENDPOINTS
// ==========================================

// 3.1 GET - Lấy danh sách (có phân trang + tìm kiếm + tối ưu song song)
app.get("/api/users", async (req, res) => {
  try {
    // Ép kiểu và gán giá trị mặc định cho phân trang
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";

    // Chống phá: Ngăn chặn FE truyền page < 1 hoặc số lượng dòng quá lớn
    if (page < 1) page = 1;
    if (limit < 1) limit = 5;
    if (limit > 100) limit = 100; // Giới hạn tối đa 100 dòng tránh sập server

    // Tạo bộ lọc regex tìm kiếm không phân biệt hoa thường (i)
    const filter = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { address: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const skip = (page - 1) * limit;

    // Sử dụng Promise.all để tối ưu hóa truy vấn song song (Yêu cầu bổ sung 1.8)
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      page,
      limit,
      total,
      totalPages,
      data: users,
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi Server: " + err.message });
  }
});

// 3.2 POST - Tạo người dùng mới
app.post("/api/users", async (req, res) => {
  try {
    const { name, age, email, address } = req.body;

    // Kiểm tra trùng lặp email trước khi lưu (Yêu cầu nâng cao)
    const existingUser = await User.findOne({ email: email?.trim() });
    if (existingUser) {
      return res.status(400).json({ error: "Email đã tồn tại trong hệ thống. Vui lòng nhập email khác." });
    }

    // Tạo bản ghi mới thông qua Mongoose Model (Tự động thực hiện trim và validate cấu trúc)
    const newUser = await User.create({ name, age, email, address });
    
    res.status(201).json({
      message: "Tạo người dùng thành công",
      data: newUser,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3.3 PUT - Cập nhật người dùng
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Chuẩn hóa và lọc dữ liệu truyền lên để tránh ghi đè null/undefined (Yêu cầu bổ sung 1.8)
    const filteredUpdate = {};
    if (updateData.name !== undefined) filteredUpdate.name = updateData.name.trim();
    if (updateData.age !== undefined) filteredUpdate.age = Number(updateData.age);
    if (updateData.address !== undefined) filteredUpdate.address = updateData.address.trim();
    
    if (updateData.email !== undefined) {
      filteredUpdate.email = updateData.email.trim();
      // Kiểm tra trùng email với người KHÁC
      const emailExists = await User.findOne({ email: filteredUpdate.email, _id: { $ne: id } });
      if (emailExists) {
        return res.status(400).json({ error: "Email đã được sử dụng bởi người dùng khác." });
      }
    }

    // Kiểm tra tính hợp lệ của ID trước khi thao tác
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    // Sử dụng new: true và runValidators: true đúng quy chuẩn tài liệu đề ra
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: filteredUpdate },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    res.json({
      message: "Cập nhật người dùng thành công",
      data: updatedUser,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3.4 DELETE - Xóa người dùng
app.delete("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra tính hợp lệ của ID (Yêu cầu bổ sung 1.8)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ trước khi tiến hành xóa." });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    res.json({ message: "Xóa người dùng thành công" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend Server đang chạy tại cổng ${PORT}`);
});