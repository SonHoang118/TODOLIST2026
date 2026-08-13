This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Neon user storage

## Schedule data architecture

The schedule is local-first while the cloud data layer is being built. Tasks are stored in the browser and are synchronized between open tabs. The boundaries are deliberately separated so a server adapter can replace the browser adapter without changing UI or task business rules.

```
ScheduleBoard → useScheduleTasks → ScheduleTaskRepository
                                      └─ BrowserScheduleTaskRepository (current)
                                      └─ ApiScheduleTaskRepository (future)
```

- `app/schedule/lib/domain/`: pure task rules, normalizers, and presentation helpers.
- `app/schedule/lib/repositories/`: persistence contract and browser implementation.
- `app/schedule/lib/hooks/`: client state lifecycle, hydration, debounce, and cross-tab updates.

The current browser snapshot key is `todolist:schedule-tasks:v1`. When cloud sync is introduced, implement `ScheduleTaskRepository` with conflict/version handling and swap the hook's adapter.

Set environment variable:

```bash
cp .env.example .env.local
```

Then update `DATABASE_URL` in `.env.local` with your Neon connection string.

## Đồng bộ lịch cho nhiều người

Lịch dùng Neon Postgres làm nguồn dữ liệu chung và Ably để đẩy thay đổi tức thì giữa các trình duyệt. Mỗi người có một lịch riêng theo `userId`; lịch công ty là một lịch chung khác. Tạo một ứng dụng ở Ably rồi thêm khóa API vào `.env.local` (không đưa khóa này lên Git):

```bash
ABLY_API_KEY=your-ably-api-key
```

Mở `/schedule` ở các máy khác nhau để kiểm tra: thay đổi task trên một máy sẽ xuất hiện ngay trên các máy còn lại. Nếu Ably tạm không cấu hình hoặc mất kết nối, ứng dụng tự tải lại lịch chung mỗi 2 giây.

Mỗi task có `version` do server tăng sau khi lưu để phát hiện sửa đồng thời. API hiện chưa gắn với phiên đăng nhập thực, vì phần chọn người dùng của giao diện đang là demo; hãy bổ sung xác thực trước khi đưa app lên Internet công khai.

Danh sách nhân viên cũng được đọc từ bảng `schedule_users` trên Neon và đồng bộ tự động. Lần chạy đầu, bảng này tạo ba tài khoản mẫu; thay đổi avatar sẽ được lưu vào Neon và cập nhật cho mọi người đang mở app.

Also configure Cloudinary for avatar upload:

```bash
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your-unsigned-upload-preset
```

Default seeded account on first run:

- Name: Ngô Thế Hiếu
- Role: ADMIN
- Avatar: empty
- Password: 123456

### API

- `POST /api/users`
- `GET /api/users`
- `POST /api/auth/login`

Create user example:

```bash
curl -X POST http://localhost:3000/api/users \
	-H "Content-Type: application/json" \
	-d '{
		"role": "ADMIN",
		"name": "Hoang Son",
		"avatar": "https://example.com/avatar.png",
		"password": "123456"
	}'
```
