import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** 화면 언어. 코드는 백엔드 constants.UI_LANGS 와 같다. */
export type Lang = "ko" | "en" | "ja" | "zh" | "vi";
const LANGS: Lang[] = ["ko", "en", "ja", "zh", "vi"];

/** 한국어 문구를 키로 쓰고 [English, 日本語, 中文, Tiếng Việt] 순서로 번역을 둔다. 번역이 없으면 한국어가 그대로 나온다. */
type Tr = [string, string, string, string];
const COLUMN: Record<Exclude<Lang, "ko">, number> = { en: 0, ja: 1, zh: 2, vi: 3 };

const D: Record<string, Tr> = {
  // 만남 약속
  "만남 약속": ["Meetup", "会う約束", "见面安排", "Lịch gặp"],
  "한국 시간 기준": ["Korea time", "韓国時間", "韩国时间", "Giờ Hàn Quốc"],
  "약속이 확정됐어요": ["Your meetup is confirmed", "約束が確定しました", "见面已确认", "Đã xác nhận lịch gặp"],
  "상대의 수락을 기다리고 있어요": ["Waiting for your partner to accept", "相手の承諾を待っています", "等待对方接受", "Đang chờ đối phương đồng ý"],
  "상대가 만남 시간을 제안했어요": ["Your partner proposed a time", "相手が会う時間を提案しました", "对方提议了见面时间", "Đối phương đã đề xuất giờ gặp"],
  "이 시간에 만나요": ["Let's meet then", "この時間に会いましょう", "就这个时间见面", "Gặp vào giờ này nhé"],
  "약속 취소": ["Cancel meetup", "約束を取り消す", "取消见面", "Hủy lịch gặp"],
  "제안 취소": ["Withdraw proposal", "提案を取り消す", "撤回提议", "Rút đề xuất"],
  "날짜": ["Date", "日付", "日期", "Ngày"],
  "날짜 선택": ["Choose a date", "日付を選ぶ", "选择日期", "Chọn ngày"],
  "시간": ["Time", "時間", "时间", "Giờ"],
  "시간 선택": ["Choose a time", "時間を選ぶ", "选择时间", "Chọn giờ"],
  "시간 제안하기": ["Propose a time", "時間を提案する", "提议时间", "Đề xuất giờ"],
  "지난 약속 이후 다음 만남을 정해 보세요": ["Plan your next meetup", "次の約束を決めましょう", "安排下一次见面吧", "Lên lịch gặp tiếp theo"],
  "상대가 제안을 거절했어요. 다른 시간을 골라 보세요": ["Your partner declined. Try another time.", "提案が断られました。別の時間を選んでください。", "对方拒绝了提议，请选择其他时间。", "Đối phương đã từ chối. Hãy chọn giờ khác."],
  "약속이 취소됐어요. 다시 제안할 수 있어요": ["Meetup cancelled. You can propose again.", "約束が取り消されました。再提案できます。", "见面已取消，可以重新提议。", "Lịch gặp đã hủy. Bạn có thể đề xuất lại."],
  "겹치는 시간으로 약속을 잡아 보세요": ["Plan a meetup when you are both free", "共通の空き時間で約束しましょう", "选择双方空闲的时间见面", "Chọn giờ cả hai đều rảnh để gặp"],
  "앞으로 2주 안에 겹치는 시간이 없어요. 프로필의 가능 시간을 확인해 주세요.": ["No shared times in the next two weeks. Check your profile availability.", "今後2週間に共通の空き時間がありません。プロフィールの空き時間を確認してください。", "未来两周没有共同空闲时间，请检查个人资料中的可用时间。", "Hai tuần tới chưa có giờ rảnh chung. Hãy kiểm tra thời gian trong hồ sơ."],
  "약속 상태가 바뀌었어요. 다시 확인해 주세요.": ["The meetup changed. Please check again.", "約束の状態が変わりました。再確認してください。", "见面状态已更改，请重新确认。", "Trạng thái lịch gặp đã đổi. Hãy kiểm tra lại."],
  "두 사람의 공통 가능한 미래 시간을 선택해 주세요.": ["Choose a future time when both of you are available.", "二人とも空いている今後の時間を選んでください。", "请选择双方空闲的未来时间。", "Chọn giờ sắp tới mà cả hai đều rảnh."],
  "지난 시간이거나 가능한 시간이 바뀌었어요. 다시 제안해 주세요.": ["This time has passed or availability changed. Please propose again.", "過去の時間か空き時間が変わりました。再提案してください。", "时间已过或可用时间已变更，请重新提议。", "Giờ đã qua hoặc thời gian rảnh đã đổi. Hãy đề xuất lại."],

  // 탭, 공통
  "겹치는 것": ["In common", "共通すること", "共同点", "Điểm chung"],
  점: ["pts", "点", "分", "điểm"],
  "상대를 누르면 대화 · 준비 · 노트가 나와요.": ["Tap a person to see chat, prep and notes.", "相手をタップするとトーク・準備・ノートが開きます。", "点击对方即可查看聊天、准备和笔记。", "Chạm vào một người để xem chat, chuẩn bị và ghi chú."],
  "겹치는 시간": ["Shared times", "共通の時間", "共同时间", "Giờ trùng"],
  "{n}개 더 보기": ["Show {n} more", "あと{n}件を表示", "再显示 {n} 个", "Xem thêm {n}"],
  "겹치는 관심사가 없어요": ["No shared interests", "共通の興味はありません", "没有共同兴趣", "Chưa có sở thích chung"],
  "겹치는 시간이 없어요": ["No shared times", "共通の時間はありません", "没有共同时间", "Chưa có giờ trùng"],
  "거절하기": ["Decline", "断る", "拒绝", "Từ chối"],
  "이번 만남에서 서로 알려줄 것": ["What you'll teach each other", "今回お互いに教えること", "这次见面互相教的内容", "Điều dạy nhau lần này"],
  "이야기 나눌 만한 공통점": ["Things in common to talk about", "話せそうな共通点", "可以聊的共同点", "Điểm chung để trò chuyện"],
  "물어볼 질문 · 눌러서 대화로 가져가요": ["Questions to ask · tap to bring to chat", "聞いてみたい質問・タップでトークへ", "想问的问题 · 点击带到聊天", "Câu hỏi · chạm để mang vào chat"],
  "{name}님이 알려준 것": ["What {name} shared", "{name}さんが教えてくれたこと", "{name}告诉你的", "Điều {name} đã chia sẻ"],
  "선택됨": ["Picked", "選択済み", "已选", "Đã chọn"],
  "준비에서 가져온 질문": ["Questions from Prepare", "準備から持ってきた質問", "来自准备的问题", "Câu hỏi từ phần chuẩn bị"],
  "만남": ["Meetings", "出会い", "见面", "Gặp gỡ"],
  "내 정보": ["My info", "マイ情報", "我的信息", "Thông tin của tôi"],
  준비: ["Prepare", "準備", "准备", "Chuẩn bị"],
  "만남 목록으로": ["Back to meetings", "出会い一覧へ", "返回见面列表", "Về danh sách"],
  "대화에서 질문하기": ["Ask in chat", "トークで質問する", "在聊天中提问", "Hỏi trong chat"],
  프로필: ["Profile", "プロフィール", "个人资料", "Hồ sơ"],
  추천: ["Matches", "おすすめ", "推荐", "Gợi ý"],
  대화: ["Chats", "トーク", "聊天", "Chat"],
  브리핑: ["Briefing", "事前情報", "简报", "Tóm tắt"],
  노트: ["Notes", "ノート", "笔记", "Ghi chú"],
  "서버에 연결하지 못했어요. 백엔드가 켜져 있는지 확인해 주세요.": ["Couldn't connect to the server. Please check that the backend is running.", "サーバーに接続できませんでした。バックエンドが起動しているか確認してください。", "无法连接服务器。请确认后端已启动。", "Không thể kết nối máy chủ. Hãy kiểm tra xem backend đã chạy chưa."],
  "불러오는 중이에요.": ["Loading…", "読み込み中です。", "加载中…", "Đang tải…"],
  "새 메시지가 왔어요": ["New message", "新しいメッセージが届きました", "收到新消息", "Có tin nhắn mới"],

  // 로그인
  "숙명여자대학교 메일로 로그인해요": ["Sign in with your Sookmyung Women's University email", "淑明女子大学のメールでログインします", "使用淑明女子大学邮箱登录", "Đăng nhập bằng email Đại học nữ Sookmyung"],
  "숙명여자대학교 메일로만 가입할 수 있어요": ["You can only sign up with a Sookmyung Women's University email", "淑明女子大学のメールでのみ登録できます", "只能使用淑明女子大学邮箱注册", "Chỉ đăng ký được bằng email Đại học nữ Sookmyung"],
  회원가입: ["Sign up", "会員登録", "注册", "Đăng ký"],
  가입하기: ["Join", "登録する", "注册", "Đăng ký"],
  "아직 계정이 없나요?": ["No account yet?", "まだアカウントがありませんか？", "还没有账号？", "Chưa có tài khoản?"],
  "이미 계정이 있나요?": ["Already have an account?", "すでにアカウントをお持ちですか？", "已有账号？", "Đã có tài khoản?"],
  회원가입하기: ["Go to sign up", "会員登録へ", "去注册", "Đến đăng ký"],
  로그인하기: ["Go to sign in", "ログインへ", "去登录", "Đến đăng nhập"],
  "가입된 메일이 아니에요. 회원가입을 해 주세요.": ["This email isn't registered. Please sign up.", "登録されていないメールです。会員登録してください。", "该邮箱尚未注册，请先注册。", "Email này chưa đăng ký. Hãy đăng ký trước."],
  "이미 가입된 메일이에요. 로그인해 주세요.": ["This email is already registered. Please sign in.", "すでに登録されているメールです。ログインしてください。", "该邮箱已注册，请直接登录。", "Email này đã đăng ký. Hãy đăng nhập."],
  "숙명여자대학교 메일로 시작해요": ["Get started with your Sookmyung email", "淑明女子大学のメールではじめましょう", "使用淑明女子大学邮箱开始", "Bắt đầu bằng email Đại học nữ Sookmyung"],
  "학교 메일 아이디": ["School email ID", "学校メールのID", "学校邮箱账号", "ID email trường"],
  "인증 코드를 입력해 주세요": ["Enter the verification code", "認証コードを入力してください", "请输入验证码", "Nhập mã xác thực"],
  "{email}로 보낸 6자리 코드를 입력해 주세요.": ["Enter the 6-digit code we sent to {email}.", "{email}に送った6桁のコードを入力してください。", "请输入发送到{email}的6位验证码。", "Nhập mã 6 chữ số đã gửi đến {email}."],
  "학교 메일": ["School email", "学校のメール", "学校邮箱", "Email trường"],
  "인증 코드 받기": ["Get verification code", "認証コードを受け取る", "获取验证码", "Nhận mã xác thực"],
  "메일을 보내는 중": ["Sending…", "メールを送信中", "正在发送…", "Đang gửi…"],
  "인증 코드 6자리": ["6-digit code", "認証コード（6桁）", "6位验证码", "Mã 6 chữ số"],
  로그인: ["Sign in", "ログイン", "登录", "Đăng nhập"],
  "확인하는 중": ["Checking…", "確認中", "验证中…", "Đang kiểm tra…"],
  "코드 다시 받기": ["Resend code", "コードを再送", "重新获取验证码", "Gửi lại mã"],
  "{n}초 뒤에 다시 받을 수 있어요": ["You can resend in {n}s", "{n}秒後に再送できます", "{n}秒后可重新获取", "Có thể gửi lại sau {n}s"],
  "{min}자 이상 {max}자 이하로 정해 주세요": ["Use {min}–{max} characters", "{min}〜{max}文字で決めてください", "请设置{min}到{max}个字符", "Dùng từ {min} đến {max} ký tự"],
  "{min}자 이상, 영문과 숫자를 함께 넣어 주세요": ["At least {min} characters, with letters and numbers", "{min}文字以上、英字と数字を含めてください", "至少{min}个字符，含字母和数字", "Ít nhất {min} ký tự, gồm chữ và số"],
  "다음": ["Next", "次へ", "下一步", "Tiếp"],
  "로그인할 때 {email}와 이 비밀번호를 써요.": ["You'll sign in with {email} and this password.", "ログインには{email}とこのパスワードを使います。", "登录时使用{email}和此密码。", "Bạn sẽ đăng nhập bằng {email} và mật khẩu này."],
  "메일 또는 비밀번호가 맞지 않아요.": ["Wrong email or password.", "メールまたはパスワードが違います。", "邮箱或密码不正确。", "Email hoặc mật khẩu không đúng."],
  "메일로 코드를 받아 새 비밀번호를 정해요": ["Get a code by email and set a new password", "メールのコードで新しいパスワードを決めます", "通过邮件验证码设置新密码", "Nhận mã qua email và đặt mật khẩu mới"],
  "보기": ["Show", "表示", "显示", "Hiện"],
  "비밀번호": ["Password", "パスワード", "密码", "Mật khẩu"],
  "비밀번호 바꾸고 로그인": ["Change password & sign in", "変更してログイン", "修改密码并登录", "Đổi mật khẩu và đăng nhập"],
  "비밀번호 설정하기": ["Set a password", "パスワードを設定", "设置密码", "Đặt mật khẩu"],
  "비밀번호 찾기": ["Reset password", "パスワードを再設定", "找回密码", "Đặt lại mật khẩu"],
  "비밀번호 확인": ["Confirm password", "パスワード(確認)", "确认密码", "Nhập lại mật khẩu"],
  "비밀번호가 기억났나요?": ["Remembered it?", "思い出しましたか?", "想起来了吗?", "Đã nhớ ra?"],
  "비밀번호가 서로 달라요": ["The passwords don't match", "パスワードが一致しません", "两次密码不一致", "Hai mật khẩu không khớp"],
  "비밀번호를 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.": ["Too many wrong attempts. Please try again in a moment.", "何度も間違えました。しばらくしてからお試しください。", "多次输入错误，请稍后再试。", "Bạn nhập sai nhiều lần. Hãy thử lại sau."],
  "비밀번호를 잊었어요": ["Forgot password?", "パスワードを忘れた", "忘记密码", "Quên mật khẩu"],
  "비밀번호를 정해 주세요": ["Create a password", "パスワードを決めてください", "请设置密码", "Hãy đặt mật khẩu"],
  "새 비밀번호를 정해 주세요": ["Set a new password", "新しいパスワードを決めてください", "请设置新密码", "Hãy đặt mật khẩu mới"],
  "숨기기": ["Hide", "非表示", "隐藏", "Ẩn"],
  "아직 비밀번호가 없는 계정이에요. '비밀번호 찾기'로 먼저 설정해 주세요.": ["This account has no password yet. Use “Reset password” to set one.", "このアカウントにはまだパスワードがありません。「パスワードを再設定」で設定してください。", "此账号尚未设置密码，请先用“找回密码”设置。", "Tài khoản này chưa có mật khẩu. Hãy đặt qua “Đặt lại mật khẩu”."],
  "영문과 숫자를 모두 넣어 주세요": ["Include both letters and numbers", "英字と数字を両方入れてください", "需同时包含字母和数字", "Cần có cả chữ và số"],
  "코드 다시 입력하기": ["Re-enter the code", "コードを入力し直す", "重新输入验证码", "Nhập lại mã"],
  "메일 주소 바꾸기": ["Change email", "メールアドレスを変更", "更换邮箱", "Đổi email"],
  "개발 모드: 인증 코드는 {code} 예요": ["Dev mode: the code is {code}", "開発モード: 認証コードは{code}です", "开发模式：验证码是{code}", "Chế độ dev: mã là {code}"],
  "코드 채우기": ["Fill in", "入力する", "自动填入", "Điền mã"],
  "개발자 입장": ["Developer entry", "開発者用入口", "开发者入口", "Lối vào cho dev"],
  "{name}(으)로 바로 들어가기": ["Enter as {name}", "{name}で入る", "以{name}进入", "Vào bằng {name}"],
  "프로필 골라서 들어가기": ["Pick a profile to enter", "プロフィールを選んで入る", "选择资料进入", "Chọn hồ sơ để vào"],
  "다른 프로필로 들어가기": ["Enter as another profile", "別のプロフィールで入る", "用其他资料进入", "Vào bằng hồ sơ khác"],
  "가짜 프로필 고르기": ["Choose a sample profile", "サンプルプロフィールを選ぶ", "选择示例资料", "Chọn hồ sơ mẫu"],
  "이 프로필로 입장": ["Enter with this profile", "このプロフィールで入る", "用此资料进入", "Vào bằng hồ sơ này"],
  "시연 전 개발용이에요. 가짜 프로필 계정으로만 들어갈 수 있어요.": ["For development before the demo. Sample profiles only.", "デモ前の開発用です。サンプルのアカウントにのみ入れます。", "演示前的开发用入口，仅限示例账号。", "Chỉ dùng khi phát triển trước buổi demo, chỉ vào được tài khoản mẫu."],
  "접기": ["Collapse", "閉じる", "收起", "Thu gọn"],
  "개발용 사용자로 둘러보기": ["Browse as a dev user", "開発用ユーザーで見る", "以开发用户浏览", "Xem bằng người dùng dev"],
  "로그인한 메일": ["Signed in as", "ログイン中のメール", "登录邮箱", "Email đang dùng"],
  로그아웃: ["Log out", "ログアウト", "退出登录", "Đăng xuất"],
  "로그아웃했어요": ["Logged out", "ログアウトしました", "已退出登录", "Đã đăng xuất"],
  "나는 어떤 학생인가요?": ["Which are you?", "あなたはどちらですか？", "你是哪一类学生？", "Bạn là sinh viên nào?"],
  "국내 학생": ["Domestic student", "国内学生", "本国学生", "Sinh viên trong nước"],
  유학생: ["International student", "留学生", "留学生", "Du học sinh"],
  "한 번 정하면 바꿀 수 없어요.": ["You can't change this later.", "一度決めると変更できません。", "选定后无法更改。", "Đã chọn thì không đổi được."],
  "로그인이 필요해요.": ["Please sign in.", "ログインが必要です。", "请先登录。", "Bạn cần đăng nhập."],
  "숙명여자대학교 메일(@sookmyung.ac.kr)만 쓸 수 있어요.": ["Only Sookmyung Women's University emails (@sookmyung.ac.kr) can be used.", "淑明女子大学のメール（@sookmyung.ac.kr）のみ使えます。", "只能使用淑明女子大学邮箱（@sookmyung.ac.kr）。", "Chỉ dùng được email Đại học nữ Sookmyung (@sookmyung.ac.kr)."],
  "메일 주소 형식이 맞지 않아요.": ["That email address isn't valid.", "メールアドレスの形式が正しくありません。", "邮箱格式不正确。", "Địa chỉ email không hợp lệ."],
  "인증 코드를 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.": ["Too many code requests. Please try again later.", "認証コードのリクエストが多すぎます。しばらくしてからお試しください。", "验证码请求过于频繁，请稍后再试。", "Bạn yêu cầu mã quá nhiều lần. Hãy thử lại sau."],
  "인증 코드가 맞지 않아요.": ["That code isn't correct.", "認証コードが違います。", "验证码不正确。", "Mã không đúng."],
  "인증 코드가 만료됐어요. 새 코드를 받아 주세요.": ["The code has expired. Please get a new one.", "認証コードの有効期限が切れました。新しいコードを受け取ってください。", "验证码已过期，请重新获取。", "Mã đã hết hạn. Hãy nhận mã mới."],
  "시도 횟수를 넘었어요. 새 코드를 받아 주세요.": ["Too many attempts. Please get a new code.", "試行回数を超えました。新しいコードを受け取ってください。", "尝试次数过多，请重新获取验证码。", "Quá số lần thử. Hãy nhận mã mới."],
  "메일 발송이 설정되지 않았어요.": ["Email sending isn't set up.", "メール送信が設定されていません。", "尚未设置邮件发送。", "Chưa thiết lập gửi email."],
  "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.": ["Couldn't send the email. Please try again shortly.", "メールを送信できませんでした。しばらくしてからお試しください。", "邮件发送失败，请稍后再试。", "Không gửi được email. Hãy thử lại sau."],
  "국내 학생인지 유학생인지 골라 주세요.": ["Please choose domestic or international student.", "国内学生か留学生かを選んでください。", "请选择本国学生或留学生。", "Hãy chọn sinh viên trong nước hay du học sinh."],
  "{v} 빼기": ["Remove {v}", "{v}を外す", "移除{v}", "Bỏ {v}"],
  "최대 {max}개까지 담을 수 있어요": ["Up to {max} items", "最大{max}個まで追加できます", "最多可添加{max}个", "Tối đa {max} mục"],
  추가: ["Add", "追加", "添加", "Thêm"],
  선택: ["Optional", "任意", "选填", "Tùy chọn"],
  완료: ["Done", "完了", "完成", "Xong"],
  "아직 없어요": ["None yet", "まだありません", "还没有", "Chưa có"],
  수정: ["Edit", "編集", "编辑", "Sửa"],
  닫기: ["Close", "閉じる", "关闭", "Đóng"],
  저장: ["Save", "保存", "保存", "Lưu"],
  "저장하는 중": ["Saving…", "保存中", "保存中", "Đang lưu"],
  "저장했어요.": ["Saved.", "保存しました。", "已保存。", "Đã lưu."],

  // 서버가 돌려주는 오류 문구
  "요청을 처리하지 못했어요.": ["Something went wrong with the request.", "リクエストを処理できませんでした。", "请求处理失败。", "Không thể xử lý yêu cầu."],
  "알 수 없는 사용자예요.": ["Unknown user.", "不明なユーザーです。", "未知用户。", "Người dùng không xác định."],
  "만남을 찾을 수 없어요.": ["Meeting not found.", "会う予定が見つかりません。", "找不到该见面。", "Không tìm thấy buổi gặp."],
  "양쪽이 수락한 만남에서만 쓸 수 있어요.": ["Only available once both have accepted.", "お互いに承諾した場合のみ使えます。", "仅在双方接受后可用。", "Chỉ dùng được khi cả hai đã chấp nhận."],
  "이미 쓰고 있는 닉네임이에요.": ["That nickname is already taken.", "そのニックネームはすでに使われています。", "该昵称已被使用。", "Biệt danh này đã có người dùng."],
  "이 만남에 참여한 사람만 할 수 있어요.": ["Only people in this meeting can do that.", "この予定の参加者だけができます。", "只有参与此次见面的人可以操作。", "Chỉ người tham gia buổi gặp này mới làm được."],
  "추천 기한이 지났어요. 새 추천을 확인해 주세요.": ["This match has expired. Please check your new matches.", "おすすめの期限が過ぎました。新しいおすすめを確認してください。", "推荐已过期，请查看新的推荐。", "Gợi ý đã hết hạn. Hãy xem gợi ý mới."],
  "이미 처리된 추천이에요.": ["This match was already handled.", "すでに処理されたおすすめです。", "该推荐已处理。", "Gợi ý này đã được xử lý."],
  "이번 주 만남 상한을 넘을 수 없어요.": ["You can't exceed this week's meeting limit.", "今週の会う回数の上限を超えられません。", "不能超过本周的见面上限。", "Không thể vượt quá giới hạn gặp mặt của tuần này."],
  "확정된 만남만 취소할 수 있어요.": ["Only confirmed meetings can be cancelled.", "確定した予定のみキャンセルできます。", "只能取消已确定的见面。", "Chỉ có thể hủy buổi gặp đã xác nhận."],
  "차단할 수 없는 사용자예요.": ["You can't block this user.", "ブロックできないユーザーです。", "无法屏蔽该用户。", "Không thể chặn người dùng này."],
  "신고할 사용자를 찾을 수 없어요.": ["User to report not found.", "通報するユーザーが見つかりません。", "找不到要举报的用户。", "Không tìm thấy người dùng cần báo cáo."],

  // 대화
  "대화방은 양쪽이 수락하면 열려요": ["Chats open when both of you accept", "お互いに承諾するとトークが開きます", "双方接受后才会开启聊天", "Phòng chat mở khi cả hai cùng chấp nhận"],
  "추천 탭에서 마음에 드는 상대를 수락해 보세요.": ["Accept someone you like in the Matches tab.", "おすすめタブで気に入った相手を承諾してみましょう。", "在推荐页接受你喜欢的人吧。", "Hãy chấp nhận người bạn thích ở tab Gợi ý."],
  "추천 보러 가기": ["See matches", "おすすめを見る", "去看推荐", "Xem gợi ý"],
  "나:": ["Me:", "自分:", "我:", "Tôi:"],
  "대화를 시작해 보세요": ["Say hello!", "トークを始めてみましょう", "开始聊天吧", "Hãy bắt đầu trò chuyện"],
  "안 읽은 메시지 {n}개": ["{n} unread messages", "未読メッセージ{n}件", "{n}条未读消息", "{n} tin chưa đọc"],
  "대화 목록으로": ["Back to chats", "トーク一覧へ", "返回聊天列表", "Về danh sách chat"],
  "연락처 공개 없이 대화해요": ["Chat without sharing contact info", "連絡先を公開せずに話せます", "无需公开联系方式即可聊天", "Trò chuyện mà không lộ thông tin liên lạc"],
  "신고·차단": ["Report / Block", "通報・ブロック", "举报·屏蔽", "Báo cáo / Chặn"],
  "신고 사유를 고르거나 차단할 수 있어요.": ["Choose a reason to report, or block.", "通報の理由を選ぶか、ブロックできます。", "可以选择举报理由或屏蔽对方。", "Chọn lý do báo cáo hoặc chặn."],
  "신고:": ["Report:", "通報:", "举报:", "Báo cáo:"],
  "부적절한 말이나 행동": ["Inappropriate words or behavior", "不適切な言動", "不当言行", "Lời nói hoặc hành vi không phù hợp"],
  "불쾌한 요청": ["Uncomfortable request", "不快な要求", "令人不适的请求", "Yêu cầu gây khó chịu"],
  기타: ["Other", "その他", "其他", "Khác"],
  차단하기: ["Block", "ブロックする", "屏蔽", "Chặn"],
  "양쪽이 수락해서 대화방이 열렸어요. 시간과 장소를 정해 보세요.": ["You both accepted, so the chat is open. Pick a time and place.", "お互いに承諾したのでトークが開きました。日時と場所を決めましょう。", "双方都已接受，聊天已开启。来定个时间和地点吧。", "Cả hai đã chấp nhận nên phòng chat đã mở. Hãy chọn thời gian và địa điểm."],
  읽음: ["Read", "既読", "已读", "Đã xem"],
  "안 읽음": ["Unread", "未読", "未读", "Chưa xem"],
  "수요일 오후 2시 어때요?": ["How about Wednesday at 2 pm?", "水曜日の午後2時はどうですか？", "周三下午2点怎么样？", "Thứ Tư lúc 2 giờ chiều được không?"],
  "학생회관 카페에서 볼까요?": ["Shall we meet at the Student Center café?", "学生会館のカフェで会いませんか？", "在学生会馆咖啡厅见面好吗？", "Mình gặp ở quán cà phê Hội sinh viên nhé?"],
  "메시지 입력": ["Type a message", "メッセージを入力", "输入消息", "Nhập tin nhắn"],
  보내기: ["Send", "送信", "发送", "Gửi"],
  "신고를 접수했어요": ["Report received", "通報を受け付けました", "已受理举报", "Đã nhận báo cáo"],
  "{name}님을 차단했어요.": ["You blocked {name}.", "{name}さんをブロックしました。", "已屏蔽{name}。", "Bạn đã chặn {name}."],

  // 추천
  "이번 주 추천 상대": ["This week's matches", "今週のおすすめ相手", "本周推荐对象", "Gợi ý tuần này"],
  "양쪽이 모두 수락하면 만남이 확정돼요.": ["The meeting is set once you both accept.", "お互いに承諾すると会うことが確定します。", "双方都接受后见面就确定了。", "Buổi gặp được xác nhận khi cả hai cùng chấp nhận."],
  "지금 추천할 상대가 없어요": ["No matches right now", "今おすすめできる相手がいません", "目前没有可推荐的对象", "Hiện chưa có gợi ý nào"],
  "프로필의 가능한 시간이나 언어를 늘리면 후보가 더 생겨요.": ["Add more available times or languages in your profile to see more candidates.", "プロフィールの参加可能な時間や言語を増やすと候補が増えます。", "在个人资料中增加可用时间或语言，候选人会更多。", "Thêm thời gian rảnh hoặc ngôn ngữ trong hồ sơ để có thêm gợi ý."],
  "다시 찾아보기": ["Search again", "もう一度探す", "重新查找", "Tìm lại"],
  "새 추천이 생겼어요": ["New matches found", "新しいおすすめが届きました", "有新的推荐", "Có gợi ý mới"],
  "아직 새 후보가 없어요": ["No new candidates yet", "まだ新しい候補はいません", "暂时没有新的候选人", "Chưa có ứng viên mới"],
  "참고할 자료가 없어서 직접 물어볼 질문만 보여드려요.": [
    "There's no reviewed guide for this, so here are questions to ask directly.",
    "参考資料がないので、直接聞ける質問だけ表示します。",
    "暂无参考资料，只显示可以直接询问的问题。",
    "Chưa có tài liệu tham khảo, nên chỉ hiển thị câu hỏi để hỏi trực tiếp.",
  ],
  "10분씩 서로 알려주기": ["Teach each other for 10 minutes", "10分ずつ教え合う", "互相教10分钟", "Dạy nhau mỗi người 10 phút"],
  "서로 궁금한 것 10분씩 묻고 답하기": ["Ask and answer for 10 minutes each", "気になることを10分ずつ聞き合う", "各用10分钟互相问答", "Hỏi đáp mỗi người 10 phút"],
  "아직 다음 활동 추천이 없어요. 교류 노트에 기록을 공유하면 추천받을 수 있어요.": ["No next-activity suggestion yet. Share a record in your exchange notes to get one.", "まだ次のアクティビティのおすすめはありません。交流ノートに記録を共有するとおすすめを受け取れます。", "还没有下次活动推荐。在交流笔记中分享记录即可获得推荐。", "Chưa có gợi ý hoạt động tiếp theo. Hãy chia sẻ ghi chép trong sổ giao lưu để nhận gợi ý."],
  "노트 쓰러 가기 →": ["Go write a note →", "ノートを書く →", "去写笔记 →", "Viết ghi chép →"],
  "다음 활동 추천": ["Next activity suggestion", "次のアクティビティのおすすめ", "下次活动推荐", "Gợi ý hoạt động tiếp theo"],
  "접기 ▲": ["Collapse ▲", "閉じる ▲", "收起 ▲", "Thu gọn ▲"],
  "펼치기 ▼": ["Expand ▼", "開く ▼", "展开 ▼", "Mở rộng ▼"],
  "채팅에 제안을 보냈어요 ✓": ["Suggestion sent in chat ✓", "チャットで提案しました ✓", "已在聊天中发送提议 ✓", "Đã gửi đề xuất trong chat ✓"],
  "{name}님에게 이 활동 제안하기": ["Suggest this activity to {name}", "{name}さんにこのアクティビティを提案する", "向{name}提议这个活动", "Đề xuất hoạt động này cho {name}"],
  "노트에서 다른 추천 받기 · 근거 자료 보기 →": ["Get another suggestion or see sources in Notes →", "ノートで別のおすすめ・根拠資料を見る →", "在笔记中获取其他推荐 · 查看依据资料 →", "Nhận gợi ý khác · xem tài liệu trong Ghi chép →"],
  "예: '아이스 아메리카노 한 잔 주세요'라는 주문 표현": ["e.g. How to order: \"One iced Americano, please\"", "例：「アイスアメリカーノを一つください」という注文表現", "例如：“请给我一杯冰美式”这样的点单说法", "Ví dụ: câu gọi món \"Cho tôi một ly Americano đá\""],
  "함께하며 알게 된 것": ["What I found out together", "一緒に過ごして分かったこと", "一起相处时了解到的", "Điều biết được khi đi cùng nhau"],
  "예: 직원이 말이 빨라서 포장인지 묻는 걸 못 알아들었어요": ["e.g. The staff spoke fast, so I missed when they asked if it was to go", "例：店員さんが早口で、持ち帰りか聞かれたのが分かりませんでした", "例如：店员说得太快，没听懂是在问要不要打包", "Ví dụ: nhân viên nói nhanh nên tôi không hiểu họ hỏi có mang về không"],
  "다음에 나누고 싶은 것": ["What I'd like to share next time", "次に一緒にやりたいこと", "下次想分享的", "Điều muốn chia sẻ lần sau"],
  "예: 윷놀이 같은 한국 전통 놀이를 배워 보고 싶어요": ["e.g. I'd like to learn a traditional Korean game like yunnori", "例：ユンノリのような韓国の伝統遊びを習ってみたいです", "例如：想学学掷柶这样的韩国传统游戏", "Ví dụ: tôi muốn học trò chơi truyền thống Hàn Quốc như yunnori"],
  "공유한 기록 읽기": ["Reading shared notes", "共有された記録を読む", "读取共享记录", "Đọc ghi chép đã chia sẻ"],
  "활동 자료집·위키백과에서 자료 찾기": ["Searching the activity library and Wikipedia", "アクティビティ資料集・ウィキペディアで資料を探す", "在活动资料集·维基百科中查找资料", "Tìm tài liệu trong thư viện hoạt động và Wikipedia"],
  "두 사람에게 맞는 활동 만들기": ["Creating an activity for you two", "二人に合うアクティビティを作る", "为你们两人制定活动", "Tạo hoạt động phù hợp cho hai người"],
  "자료를 참고한 추천 준비": ["Preparing a suggestion using sources", "資料を参考にしたおすすめを準備", "准备参考资料的推荐", "Chuẩn bị gợi ý có tham khảo tài liệu"],
  "자료 없이 기록만 보고 한 번 더 만들기": ["Making another one from notes only, without sources", "資料なしで記録だけからもう一度作る", "不用资料，只根据记录再生成一次", "Tạo thêm một lần chỉ dựa vào ghi chép"],
  "어느 쪽이 나은지 블라인드 심사": ["Blind review of which is better", "どちらが良いかブラインド審査", "盲评哪一个更好", "Đánh giá ẩn danh xem bên nào tốt hơn"],
  "다음 만남을 준비하고 있어요": ["Preparing your next meetup", "次に会う準備をしています", "正在准备下次见面", "Đang chuẩn bị cho buổi gặp tiếp theo"],
  "보통 10~30초 걸려요. 창을 닫아도 기록은 그대로예요.": ["This usually takes 10–30 seconds. Your notes stay even if you close the window.", "通常10〜30秒かかります。画面を閉じても記録は残ります。", "通常需要10~30秒。关闭窗口记录也会保留。", "Thường mất 10–30 giây. Đóng cửa sổ thì ghi chép vẫn được giữ."],
  "만남 뒤, 함께한 순간을 남겨요": ["After meeting, save the moments you shared", "会った後、一緒の時間を残しましょう", "见面后，记录一起度过的时光", "Sau khi gặp, hãy lưu lại khoảnh khắc cùng nhau"],
  "서로 수락한 상대와 교류 노트를 쓸 수 있어요.": ["You can write exchange notes with someone you've both accepted.", "お互いに承諾した相手と交流ノートを書けます。", "可以和双方都接受的对象写交流笔记。", "Bạn có thể viết sổ giao lưu với người mà cả hai đã chấp nhận."],
  "상대 추천 보기": ["See matches", "おすすめを見る", "查看推荐", "Xem gợi ý"],
  "기록을 저장했어요. 이제 다음 활동을 추천받을 수 있어요": ["Saved. You can now get a next-activity suggestion", "記録を保存しました。次のアクティビティのおすすめを受け取れます", "已保存记录。现在可以获取下次活动推荐了", "Đã lưu. Giờ bạn có thể nhận gợi ý hoạt động tiếp theo"],
  "기록을 저장했어요 (공유한 항목 없음)": ["Saved (nothing shared)", "記録を保存しました（共有した項目なし）", "已保存记录（没有共享项）", "Đã lưu (không có mục chia sẻ)"],
  "내 기록을 삭제했어요": ["Your note was deleted", "自分の記録を削除しました", "已删除我的记录", "Đã xóa ghi chép của bạn"],
  "교류 노트": ["Exchange notes", "交流ノート", "交流笔记", "Sổ giao lưu"],
  "만남에서 배운 것을 남겨요. 공유한 기록으로 다음에 함께할 활동을 추천해 드려요.": ["Save what you learned when you met. We'll suggest what to do together next from your shared notes.", "会って学んだことを残しましょう。共有した記録から次に一緒にやるアクティビティをおすすめします。", "记录见面时学到的东西。我们会根据共享的记录推荐下次一起做的活动。", "Lưu lại điều đã học khi gặp. Chúng tôi sẽ gợi ý hoạt động tiếp theo dựa trên ghi chép đã chia sẻ."],
  "우리 기록을 불러오는 중이에요…": ["Loading your notes…", "記録を読み込んでいます…", "正在加载记录…", "Đang tải ghi chép…"],
  "내 기록": ["My notes", "自分の記録", "我的记录", "Ghi chép của tôi"],
  "수정하기": ["Edit", "編集", "修改", "Sửa"],
  "공유함 · 추천에 사용": ["Shared · used for suggestions", "共有 · おすすめに使用", "已共享 · 用于推荐", "Đã chia sẻ · dùng để gợi ý"],
  "나만 보기 · 추천에 안 씀": ["Only me · not used for suggestions", "自分だけ · おすすめに使わない", "仅自己可见 · 不用于推荐", "Chỉ mình tôi · không dùng để gợi ý"],
  "오늘 서로 무엇을 배웠나요?": ["What did you learn from each other today?", "今日はお互いに何を学びましたか？", "今天你们互相学到了什么？", "Hôm nay hai bạn đã học được gì từ nhau?"],
  "짧은 한 문장이면 충분해요.": ["One short sentence is enough.", "短い一文で十分です。", "一句简短的话就够了。", "Một câu ngắn là đủ."],
  "공유할 내용은 직접 고를 수 있어요.": ["You choose what to share.", "共有する内容は自分で選べます。", "共享什么由你自己选择。", "Bạn tự chọn nội dung để chia sẻ."],
  "기록 남기기": ["Write a note", "記録を残す", "写记录", "Viết ghi chép"],
  "{name}님이 공유한 기록": ["Shared by {name}", "{name}さんが共有した記録", "{name}分享的记录", "Ghi chép {name} đã chia sẻ"],
  "아직 {name}님이 공유한 기록이 없어요. 내 기록만 있어도 추천받을 수 있어요.": ["{name} hasn't shared anything yet. Your notes alone are enough to get a suggestion.", "{name}さんはまだ記録を共有していません。自分の記録だけでもおすすめを受け取れます。", "{name}还没有分享记录。只有你的记录也可以获得推荐。", "{name} chưa chia sẻ ghi chép nào. Chỉ cần ghi chép của bạn cũng có thể nhận gợi ý."],
  "위 기록으로 다음 활동 추천받기": ["Get a next-activity suggestion from these notes", "上の記録で次のアクティビティのおすすめを受け取る", "根据以上记录获取下次活动推荐", "Nhận gợi ý hoạt động tiếp theo từ ghi chép trên"],
  "공유한 기록이 없어요. 기록을 수정해서 추천에 쓸 항목을 공유해 주세요.": ["Nothing is shared. Edit your note and share the items to use for suggestions.", "共有した記録がありません。記録を編集して、おすすめに使う項目を共有してください。", "没有共享的记录。请修改记录并共享用于推荐的项目。", "Chưa có mục nào được chia sẻ. Hãy sửa ghi chép và chia sẻ mục dùng để gợi ý."],
  "먼저 위에 기록을 남기고 공유를 켜 주세요.": ["First write a note above and turn on sharing.", "まず上で記録を残して、共有をオンにしてください。", "请先在上方写记录并开启共享。", "Trước tiên hãy viết ghi chép ở trên và bật chia sẻ."],
  "{n}분": ["{n} min", "{n}分", "{n}分钟", "{n} phút"],
  "준비물": ["To bring", "持ち物", "准备物品", "Cần chuẩn bị"],
  "자세히 보고 {name}님에게 제안하기": ["See details and suggest it to {name}", "詳しく見て{name}さんに提案する", "查看详情并向{name}提议", "Xem chi tiết và đề xuất cho {name}"],
  "공유한 기록 {n}개(나 {mine} · {name}님 {theirs})를 바탕으로 활동 자료집·위키백과를 찾아보고 20~30분짜리 활동을 만들어요.": ["From {n} shared notes (me {mine} · {name} {theirs}), we search the activity library and Wikipedia and make a 20–30 minute activity.", "共有した記録{n}件（自分 {mine} · {name}さん {theirs}）をもとに、アクティビティ資料集・ウィキペディアを調べて20〜30分のアクティビティを作ります。", "根据{n}条共享记录（我 {mine} · {name} {theirs}），查找活动资料集·维基百科，制定20~30分钟的活动。", "Dựa trên {n} ghi chép đã chia sẻ (tôi {mine} · {name} {theirs}), chúng tôi tìm trong thư viện hoạt động và Wikipedia để tạo hoạt động 20–30 phút."],
  "다음 활동 추천받기": ["Get a next-activity suggestion", "次のアクティビティのおすすめを受け取る", "获取下次活动推荐", "Nhận gợi ý hoạt động tiếp theo"],
  "자료를 찾아본 게 도움이 됐을까?": ["Did searching sources help?", "資料を調べたのは役に立った？", "查找资料有帮助吗？", "Tìm tài liệu có giúp ích không?"],
  "같은 기록으로 자료 없이 만든 추천과 나란히 비교해요.": ["Compare side by side with a suggestion made from the same notes without sources.", "同じ記録で資料なしに作ったおすすめと並べて比べます。", "与用相同记录但不查资料生成的推荐并排比较。", "So sánh song song với gợi ý tạo từ cùng ghi chép nhưng không dùng tài liệu."],
  "내 기록 수정": ["Edit my note", "自分の記録を編集", "修改我的记录", "Sửa ghi chép của tôi"],
  "만남 기록하기": ["Record your meetup", "会った記録を書く", "记录见面", "Ghi lại buổi gặp"],
  "{name}님과 함께 배운 표현과 경험을 남겨보세요. 모든 항목은 선택이에요.": ["Write down expressions and experiences you shared with {name}. Every field is optional.", "{name}さんと一緒に学んだ表現や経験を残してみましょう。すべて任意です。", "记录下和{name}一起学到的表达和经历。所有项目都是选填。", "Hãy ghi lại cách diễn đạt và trải nghiệm cùng {name}. Tất cả các mục đều không bắt buộc."],
  "{name}님과 공유하고 추천에 사용": ["Share with {name} and use for suggestions", "{name}さんと共有しておすすめに使う", "与{name}共享并用于推荐", "Chia sẻ với {name} và dùng để gợi ý"],
  "공유한 항목만 {name}님에게 보이고 다음 활동 추천에 쓰여요. 이름·연락처는 적지 마세요.": ["Only shared items are visible to {name} and used for suggestions. Don't write names or contact info.", "共有した項目だけが{name}さんに見え、次のおすすめに使われます。名前や連絡先は書かないでください。", "只有共享的项目对{name}可见并用于推荐。请不要写姓名或联系方式。", "Chỉ mục đã chia sẻ mới hiển thị với {name} và dùng để gợi ý. Đừng ghi tên hay thông tin liên lạc."],
  "저장하는 중…": ["Saving…", "保存中…", "正在保存…", "Đang lưu…"],
  "기록 저장하기": ["Save note", "記録を保存", "保存记录", "Lưu ghi chép"],
  "취소": ["Cancel", "キャンセル", "取消", "Hủy"],
  "내 기록 삭제": ["Delete my note", "自分の記録を削除", "删除我的记录", "Xóa ghi chép của tôi"],
  "내 기록을 삭제할까요?": ["Delete your note?", "自分の記録を削除しますか？", "要删除我的记录吗？", "Xóa ghi chép của bạn?"],
  "내 기록과 이 기록으로 만든 추천·평가가 삭제됩니다. 이미 보낸 채팅은 남아요.": ["Your note and the suggestions and ratings made from it will be deleted. Messages already sent stay.", "自分の記録と、それをもとにしたおすすめ・評価が削除されます。送信済みのチャットは残ります。", "我的记录以及据此生成的推荐和评价将被删除。已发送的聊天会保留。", "Ghi chép của bạn cùng gợi ý và đánh giá tạo từ nó sẽ bị xóa. Tin nhắn đã gửi vẫn giữ nguyên."],
  "삭제 중…": ["Deleting…", "削除中…", "正在删除…", "Đang xóa…"],
  "삭제하기": ["Delete", "削除する", "删除", "Xóa"],
  "돌아가기": ["Back", "戻る", "返回", "Quay lại"],
  "다음 교류 활동": ["Next exchange activity", "次の交流アクティビティ", "下次交流活动", "Hoạt động giao lưu tiếp theo"],
  "자료 검색 효과 비교": ["Compare: did source search help?", "資料検索の効果を比較", "资料搜索效果比较", "So sánh hiệu quả tìm tài liệu"],
  "다시 시도하기": ["Try again", "もう一度試す", "重试", "Thử lại"],
  "번역 보기": ["Translate", "翻訳する", "翻译", "Dịch"],
  "원문만 보기": ["Show original", "原文だけ見る", "只看原文", "Chỉ xem bản gốc"],
  "번역하는 중": ["Translating…", "翻訳中…", "翻译中…", "Đang dịch…"],
  "지금은 번역할 수 없어요": ["Translation isn't available right now", "今は翻訳できません", "暂时无法翻译", "Hiện chưa dịch được"],
  "추천 이유": ["Why we picked them", "おすすめの理由", "推荐理由", "Lý do gợi ý"],
  "글자는 달라도 뜻이 가까운 관심사예요": ["Different words, similar meaning", "言葉は違っても意味が近い関心事です", "文字不同但意思相近的兴趣", "Khác từ nhưng nghĩa gần nhau"],
  "겹치는 항목이 없어요": ["Nothing in common yet", "共通の項目はありません", "没有重合的项目", "Chưa có điểm chung"],
  "내가 알려줄 것": ["What I can teach", "私が教えられること", "我能教的", "Mình có thể chỉ"],
  "{name}님이 알려줄 것": ["What {name} can teach", "{name}さんが教えられること", "{name}能教的", "{name} có thể chỉ"],
  "정해지지 않았어요": ["Not set", "未設定です", "尚未确定", "Chưa chọn"],
  "{name}님의 수락을 기다리는 중이에요. 자리를 임시로 잡아 두었고, 약 {h}시간 안에 답이 없으면 풀려요.": ["Waiting for {name} to accept. Your spot is held for now and will be released if there's no reply within about {h} hours.", "{name}さんの承諾を待っています。枠を仮押さえしていて、約{h}時間以内に返事がないと解除されます。", "正在等待{name}接受。名额已暂时保留，约{h}小时内无回复将释放。", "Đang chờ {name} chấp nhận. Chỗ của bạn được giữ tạm và sẽ được nhả nếu không có phản hồi trong khoảng {h} giờ."],
  "{name}님이 수락했어요": ["{name} accepted", "{name}さんが承諾しました", "{name}已接受", "{name} đã chấp nhận"],
  "양쪽이 수락했어요. 1:1 대화방이 열렸어요.": ["You both accepted. A 1:1 chat is open.", "お互いに承諾しました。1対1のトークが開きました。", "双方已接受，1对1聊天已开启。", "Cả hai đã chấp nhận. Phòng chat 1:1 đã mở."],
  "대화방 열기": ["Open chat", "トークを開く", "打开聊天", "Mở phòng chat"],
  "예약을 풀고 다음 추천을 찾았어요": ["Released the spot and found the next match", "枠を解除して次のおすすめを探しました", "已释放名额并寻找下一个推荐", "Đã nhả chỗ và tìm gợi ý tiếp theo"],
  "다른 추천 보기": ["See another", "別のおすすめを見る", "看其他推荐", "Xem gợi ý khác"],
  수락하기: ["Accept", "承諾する", "接受", "Chấp nhận"],
  "거절하면 예약이 풀리고, 미매칭자만 다시 배정돼요. 수락 기한은 약 {h}시간 남았어요.": ["If you decline, the spot is released and only unmatched people are reassigned. About {h} hours left to accept.", "断ると枠が解除され、未マッチの人だけが再配分されます。承諾の期限まで約{h}時間です。", "拒绝后名额将释放，仅未匹配的人会被重新分配。距接受截止约剩{h}小时。", "Nếu từ chối, chỗ sẽ được nhả và chỉ những người chưa ghép cặp được phân lại. Còn khoảng {h} giờ để chấp nhận."],
  "{value}점": ["{value} points", "{value}点", "{value}分", "{value} điểm"],

  // 프로필
  "내 프로필": ["My profile", "マイプロフィール", "我的资料", "Hồ sơ của tôi"],
  "한 줄 소개를 적어 보세요": ["Add a one-line intro", "ひとことを書いてみましょう", "写一句自我介绍吧", "Hãy viết một dòng giới thiệu"],
  "대화할 수 있는 언어": ["Languages I can chat in", "話せる言語", "可使用的聊天语言", "Ngôn ngữ có thể trò chuyện"],
  "이번 주 가능한 시간": ["Available this week", "今週空いている時間", "本周可用时间", "Thời gian rảnh tuần này"],
  "좋아하는 것": ["Things I like", "好きなこと", "喜欢的事物", "Điều mình thích"],
  "예: 뜨개질": ["e.g. knitting", "例: 編み物", "例如：编织", "VD: đan len"],
  "서로 하나씩 알려줘요": ["Teach each other one thing", "お互いにひとつずつ教え合おう", "互相教一样东西", "Cùng chỉ cho nhau một điều"],
  "알려줄 수 있어요": ["I can teach", "教えられます", "我能教", "Mình có thể chỉ"],
  "예: 학교 앞 맛집": ["e.g. restaurants near campus", "例: 学校前のおいしい店", "例如：学校附近的美食", "VD: quán ngon gần trường"],
  "배우고 싶어요": ["I want to learn", "学びたいです", "我想学", "Mình muốn học"],
  "예: 일본어 인사말": ["e.g. Japanese greetings", "例: 日本語のあいさつ", "例如：日语问候语", "VD: lời chào tiếng Nhật"],
  "만나기 전 알려둘 내 취향": ["My preferences to share before we meet", "会う前に伝えておきたい好み", "见面前想告知的偏好", "Sở thích muốn cho biết trước khi gặp"],
  "예: 조용한 장소가 좋아요, 매운 음식은 피해요": ["e.g. I like quiet places, I avoid spicy food", "例: 静かな場所が好き、辛い食べ物は苦手", "例如：喜欢安静的地方，不吃辣", "VD: thích nơi yên tĩnh, tránh đồ cay"],
  국적: ["Nationality", "国籍", "国籍", "Quốc tịch"],
  "가능한 시간과 대화 언어를 하나 이상 골라 주세요.": ["Choose at least one available time and one chat language.", "参加できる時間と会話言語をそれぞれ1つ以上選んでください。", "请至少选择一个可用时间和一种聊天语言。", "Hãy chọn ít nhất một thời gian rảnh và một ngôn ngữ."],
  "저장하고 추천 받기": ["Save and get matches", "保存しておすすめを見る", "保存并获取推荐", "Lưu và nhận gợi ý"],
  "저장했어요. 새 추천을 확인해 보세요.": ["Saved. Check your new matches.", "保存しました。新しいおすすめを確認してみましょう。", "已保存。看看新的推荐吧。", "Đã lưu. Hãy xem gợi ý mới."],
  오전만: ["Mornings only", "午前のみ", "仅上午", "Chỉ buổi sáng"],
  오후만: ["Afternoons only", "午後のみ", "仅下午", "Chỉ buổi chiều"],
  저녁만: ["Evenings only", "夕方のみ", "仅晚上", "Chỉ buổi tối"],
  모두: ["All", "すべて", "全部", "Tất cả"],
  비우기: ["Clear", "クリア", "清空", "Xóa hết"],
  월: ["Mon", "月", "周一", "T2"],
  화: ["Tue", "火", "周二", "T3"],
  수: ["Wed", "水", "周三", "T4"],
  목: ["Thu", "木", "周四", "T5"],
  금: ["Fri", "金", "周五", "T6"],
  오전: ["Morning", "午前", "上午", "Sáng"],
  오후: ["Afternoon", "午後", "下午", "Chiều"],
  저녁: ["Evening", "夕方", "晚上", "Tối"],

  // 관심사, 주제 (저장되는 값은 한국어 그대로이고 보여줄 때만 바뀐다)
  카페: ["Cafés", "カフェ", "咖啡厅", "Quán cà phê"],
  맛집: ["Good eats", "グルメ", "美食", "Quán ngon"],
  전시: ["Exhibitions", "展覧会", "展览", "Triển lãm"],
  영화: ["Movies", "映画", "电影", "Phim"],
  드라마: ["Dramas", "ドラマ", "电视剧", "Phim truyền hình"],
  독서: ["Reading", "読書", "阅读", "Đọc sách"],
  사진: ["Photography", "写真", "摄影", "Nhiếp ảnh"],
  음악: ["Music", "音楽", "音乐", "Âm nhạc"],
  러닝: ["Running", "ランニング", "跑步", "Chạy bộ"],
  산책: ["Walks", "散歩", "散步", "Đi dạo"],
  보드게임: ["Board games", "ボードゲーム", "桌游", "Board game"],
  요리: ["Cooking", "料理", "烹饪", "Nấu ăn"],
  여행: ["Travel", "旅行", "旅行", "Du lịch"],
  "캠퍼스 생활 팁": ["Campus life tips", "キャンパスライフのコツ", "校园生活小贴士", "Mẹo sống ở trường"],
  "식당 주문 요령": ["How to order at restaurants", "食堂での注文の仕方", "餐厅点餐技巧", "Cách gọi món ở nhà hàng"],
  "한국어 표현": ["Korean expressions", "韓国語の表現", "韩语表达", "Cách nói tiếng Hàn"],
  "과제·수강신청 팁": ["Assignment & course registration tips", "課題・履修登録のコツ", "作业与选课小贴士", "Mẹo làm bài tập & đăng ký môn"],
  "서울 카페·맛집": ["Seoul cafés & eats", "ソウルのカフェ・グルメ", "首尔咖啡厅与美食", "Quán cà phê & quán ngon ở Seoul"],
  "일본어 일상 표현": ["Everyday Japanese", "日本語の日常表現", "日语日常用语", "Tiếng Nhật hằng ngày"],
  "일본 문화": ["Japanese culture", "日本文化", "日本文化", "Văn hóa Nhật Bản"],
  "중국어 표현": ["Chinese expressions", "中国語の表現", "汉语表达", "Cách nói tiếng Trung"],
  "중국 문화": ["Chinese culture", "中国文化", "中国文化", "Văn hóa Trung Quốc"],
  "베트남어 기초": ["Basic Vietnamese", "ベトナム語の基礎", "越南语基础", "Tiếng Việt cơ bản"],
  "베트남 음식 이야기": ["Vietnamese food stories", "ベトナム料理の話", "越南美食故事", "Chuyện ẩm thực Việt Nam"],
  "English 회화": ["English conversation", "英会話", "英语会话", "Hội thoại tiếng Anh"],
  "미국 대학 문화": ["US college culture", "アメリカの大学文化", "美国大学文化", "Văn hóa đại học Mỹ"],

  // 기본 정보
  "먼저 나를 소개해 주세요": ["Tell us about yourself", "まず自己紹介をしてください", "先来介绍一下自己吧", "Hãy giới thiệu về bạn"],
  "기본 정보": ["Basic info", "基本情報", "基本信息", "Thông tin cơ bản"],
  닉네임: ["Nickname", "ニックネーム", "昵称", "Biệt danh"],
  "상대에게 보여요": ["Shown to others", "相手に表示されます", "会显示给对方", "Hiển thị cho người khác"],
  "한 줄 소개": ["One-line intro", "ひとこと紹介", "一句话介绍", "Giới thiệu một dòng"],
  "예: 카페 투어가 취미예요": ["e.g. I love café hopping", "例: カフェ巡りが趣味です", "例如：我喜欢探店咖啡厅", "VD: mình thích đi quán cà phê"],
  시작하기: ["Get started", "はじめる", "开始", "Bắt đầu"],
  "반가워요! 이제 프로필을 채워 볼까요?": ["Nice to meet you! Let's fill in your profile.", "はじめまして！プロフィールを入力しましょう。", "很高兴认识你！来填写个人资料吧。", "Rất vui được gặp bạn! Cùng điền hồ sơ nhé."],
  "화면 언어": ["Display language", "表示言語", "显示语言", "Ngôn ngữ hiển thị"],

  // 브리핑
  "브리핑은 만남이 확정되면 보여요": ["The briefing appears once a meeting is confirmed", "ブリーフィングは会うことが確定すると表示されます", "确定见面后会显示简报", "Tóm tắt sẽ hiện khi buổi gặp được xác nhận"],
  "추천 탭에서 먼저 상대를 수락해 보세요.": ["Accept someone in the Matches tab first.", "まずおすすめタブで相手を承諾してみましょう。", "请先在推荐页接受一位对象。", "Hãy chấp nhận một người ở tab Gợi ý trước."],
  "{name}님을 만나기 전에": ["Before meeting {name}", "{name}さんに会う前に", "见{name}之前", "Trước khi gặp {name}"],
  "개인 선호가 문화 일반 정보보다 우선이에요. 국적으로 성향을 추정하지 않아요.": ["Personal preferences come before general cultural info. We don't guess personality from nationality.", "個人の好みは一般的な文化情報より優先されます。国籍で性格を推測しません。", "个人偏好优先于一般文化信息。我们不会根据国籍推测性格。", "Sở thích cá nhân được ưu tiên hơn thông tin văn hóa chung. Chúng tôi không đoán tính cách theo quốc tịch."],
  "브리핑을 준비하는 중이에요.": ["Preparing the briefing…", "ブリーフィングを準備中です。", "正在准备简报…", "Đang chuẩn bị tóm tắt…"],
  "{name}님이 공개한 선호": ["Preferences {name} shared", "{name}さんが公開した好み", "{name}公开的偏好", "Sở thích {name} đã chia sẻ"],
  "공개한 선호가 없어요. 직접 물어보면 좋아요.": ["No preferences shared. Try asking directly.", "公開された好みはありません。直接聞いてみましょう。", "对方没有公开偏好。可以直接问问看。", "Chưa có sở thích nào được chia sẻ. Bạn có thể hỏi trực tiếp."],
  "참고할 문화 정보": ["Cultural info to keep in mind", "参考になる文化情報", "可参考的文化信息", "Thông tin văn hóa tham khảo"],
  "출처 · {source}": ["Source · {source}", "出典 · {source}", "来源 · {source}", "Nguồn · {source}"],
  "AI가 만든 문장이 아니라 검토 자료를 그대로 보여주는 기본 안내예요.": ["This is a default guide showing reviewed material as-is, not AI-written text.", "AIが作った文ではなく、確認済みの資料をそのまま表示する基本案内です。", "这是直接展示已审核资料的默认说明，并非AI生成的文字。", "Đây là hướng dẫn mặc định hiển thị tài liệu đã duyệt, không phải văn bản do AI tạo."],
  "직접 물어볼 만한 질문": ["Questions you could ask", "聞いてみるとよい質問", "可以直接问的问题", "Câu hỏi có thể hỏi"],
  "서로 하나씩 알려주기": ["Teaching each other", "お互いに教え合う", "互相教学", "Chỉ cho nhau"],
  "나 · {n}분": ["Me · {n} min", "私 · {n}分", "我 · {n}分钟", "Tôi · {n} phút"],
  "{name} · {n}분": ["{name} · {n} min", "{name} · {n}分", "{name} · {n}分钟", "{name} · {n} phút"],
  "국적이 아니라 각자 고른 주제로 역할이 정해져요.": ["Roles are based on the topics each of you chose, not nationality.", "役割は国籍ではなく、それぞれが選んだテーマで決まります。", "角色由各自选择的话题决定，而非国籍。", "Vai trò dựa trên chủ đề mỗi người chọn, không phải quốc tịch."],
  "(기본 카드)": ["(default card)", "(基本カード)", "（默认卡片）", "(thẻ mặc định)"],
  "만난 뒤 교류 노트 쓰기": ["Write an exchange note after meeting", "会った後に交流ノートを書く", "见面后写交流笔记", "Viết ghi chú sau buổi gặp"],

  // 노트
  "교류 노트는 만남 뒤에 쓸 수 있어요": ["You can write exchange notes after a meeting", "交流ノートは会った後に書けます", "见面后才能写交流笔记", "Bạn có thể viết ghi chú sau buổi gặp"],
  "새로 배운 표현": ["A new expression I learned", "新しく覚えた表現", "新学到的表达", "Cách nói mới học được"],
  "새로 알게 된 것": ["Something new I found out", "新しく知ったこと", "新了解到的事", "Điều mới biết"],
  "다음에 하고 싶은 것": ["What I want to do next", "次にやりたいこと", "下次想做的事", "Điều muốn làm lần sau"],
  "예: 주문할게요 → お願いします": ["e.g. 주문할게요 → I'd like to order", "例: 주문할게요 → 注文をお願いします", "例如：주문할게요 → 我要点餐", "VD: 주문할게요 → Cho mình gọi món"],
  "예: 도서관은 학생증으로 들어가요": ["e.g. You enter the library with your student ID", "例: 図書館は学生証で入れます", "例如：用学生证进入图书馆", "VD: vào thư viện bằng thẻ sinh viên"],
  "예: 도서관 이용법 알려주기": ["e.g. Show how to use the library", "例: 図書館の使い方を教える", "例如：介绍图书馆的使用方法", "VD: chỉ cách dùng thư viện"],
  "{name}님과의 교류 노트": ["Exchange notes with {name}", "{name}さんとの交流ノート", "与{name}的交流笔记", "Ghi chú trao đổi với {name}"],
  "기본은 비공개예요. 공유를 켠 항목만 상대에게 보여요.": ["Private by default. Only items you turn sharing on for are shown to the other person.", "基本は非公開です。共有をオンにした項目だけが相手に表示されます。", "默认不公开。只有开启分享的项目才会显示给对方。", "Mặc định là riêng tư. Chỉ mục nào bật chia sẻ mới hiển thị cho đối phương."],
  "상대에게 공유": ["Share with them", "相手に共有", "分享给对方", "Chia sẻ với họ"],
  "{label} 공유": ["Share {label}", "{label}を共有", "分享{label}", "Chia sẻ {label}"],
  "{name}님이 공유한 노트": ["Notes {name} shared", "{name}さんが共有したノート", "{name}分享的笔记", "Ghi chú {name} đã chia sẻ"],
  "노트 저장하고 다음 활동 받기": ["Save note and get next activity", "ノートを保存して次の活動をもらう", "保存笔记并获取下次活动", "Lưu ghi chú và nhận hoạt động tiếp theo"],
  "노트를 저장했어요. 삭제는 언제든 할 수 있어요.": ["Note saved. You can delete it anytime.", "ノートを保存しました。いつでも削除できます。", "笔记已保存，可随时删除。", "Đã lưu ghi chú. Bạn có thể xóa bất cứ lúc nào."],
  "다음 활동 제안": ["Next activity suggestion", "次の活動の提案", "下次活动建议", "Gợi ý hoạt động tiếp theo"],
  "제안 보내기": ["Send suggestion", "提案を送る", "发送建议", "Gửi đề xuất"],
  "정기 만남 정하기": ["Set a regular meetup", "定期的な集まりを決める", "约定定期见面", "Đặt lịch gặp định kỳ"],
  "내 노트 삭제": ["Delete my note", "自分のノートを削除", "删除我的笔记", "Xóa ghi chú của tôi"],
  "노트를 저장했어요": ["Note saved", "ノートを保存しました", "笔记已保存", "Đã lưu ghi chú"],
  "노트를 삭제했어요": ["Note deleted", "ノートを削除しました", "笔记已删除", "Đã xóa ghi chú"],
  "다음 활동 제안은 아직 연결되지 않았어요": ["Sending suggestions isn't connected yet", "次の活動の提案はまだ連携されていません", "下次活动建议功能尚未接入", "Gửi đề xuất chưa được kết nối"],
  "정기 만남 일정 정하기는 아직 연결되지 않았어요": ["Setting a regular meetup isn't connected yet", "定期的な集まりの日程設定はまだ連携されていません", "约定定期见面功能尚未接入", "Đặt lịch gặp định kỳ chưa được kết nối"],
};

const CLOCK_LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN", vi: "vi-VN" };

function isLang(v: string | null | undefined): v is Lang {
  return !!v && (LANGS as string[]).includes(v);
}

/** 저장된 선택 → 브라우저 언어 → 한국어 순서로 처음 언어를 정한다. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (isLang(saved)) return saved;
  } catch {
    /* 저장이 막혀 있어도 동작에는 문제 없음 */
  }
  const nav = (navigator.language || "ko").slice(0, 2).toLowerCase();
  return isLang(nav) ? nav : "ko";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** 한국어 문구를 현재 화면 언어로. {name} 같은 자리는 vars 로 채운다. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** 옵션 값(관심사, 주제, "월 오전" 같은 시간)을 보여줄 때 쓴다. 직접 입력한 값은 그대로 둔다. */
  tv: (value: string) => string;
  clock: (iso: string) => string;
}

const Ctx = createContext<I18n>({ lang: "ko", setLang: () => undefined, t: (k) => k, tv: (v) => v, clock: (i) => i });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const t: I18n["t"] = (key, vars) => {
      const hit = lang === "ko" ? undefined : D[key]?.[COLUMN[lang]];
      const text = hit ?? key;
      return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
    };
    const tv: I18n["tv"] = (value) => {
      if (lang === "ko") return value;
      if (D[value]) return t(value);
      const hourly = value.match(/^([월화수목금]) (\d{2}:00–\d{2}:00)$/);
      if (hourly) return `${t(hourly[1])} ${hourly[2]}`;
      const parts = value.split(" ");
      return parts.length > 1 && parts.every((p) => D[p]) ? parts.map((p) => t(p)).join(" ") : value;
    };
    const clock: I18n["clock"] = (iso) => new Date(iso + "Z").toLocaleTimeString(CLOCK_LOCALE[lang], { hour: "numeric", minute: "2-digit" });
    return { lang, setLang, t, tv, clock };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export { isLang };
