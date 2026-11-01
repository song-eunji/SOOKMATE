import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** 화면 언어. 코드는 백엔드 constants.UI_LANGS 와 같다. */
export type Lang = "ko" | "en" | "ja" | "zh" | "vi";
const LANGS: Lang[] = ["ko", "en", "ja", "zh", "vi"];

/** 한국어 문구를 키로 쓰고 [English, 日本語, 中文, Tiếng Việt] 순서로 번역을 둔다. 번역이 없으면 한국어가 그대로 나온다. */
type Tr = [string, string, string, string];
const COLUMN: Record<Exclude<Lang, "ko">, number> = { en: 0, ja: 1, zh: 2, vi: 3 };

const D: Record<string, Tr> = {
  // 탭, 공통
  프로필: ["Profile", "プロフィール", "个人资料", "Hồ sơ"],
  추천: ["Matches", "おすすめ", "推荐", "Gợi ý"],
  대화: ["Chats", "トーク", "聊天", "Chat"],
  브리핑: ["Briefing", "事前情報", "简报", "Tóm tắt"],
  노트: ["Notes", "ノート", "笔记", "Ghi chú"],
  "서버에 연결하지 못했어요. 백엔드가 켜져 있는지 확인해 주세요.": ["Couldn't connect to the server. Please check that the backend is running.", "サーバーに接続できませんでした。バックエンドが起動しているか確認してください。", "无法连接服务器。请确认后端已启动。", "Không thể kết nối máy chủ. Hãy kiểm tra xem backend đã chạy chưa."],
  "불러오는 중이에요.": ["Loading…", "読み込み中です。", "加载中…", "Đang tải…"],
  "새 메시지가 왔어요": ["New message", "新しいメッセージが届きました", "收到新消息", "Có tin nhắn mới"],
  "{v} 빼기": ["Remove {v}", "{v}を外す", "移除{v}", "Bỏ {v}"],
  "최대 {max}개까지 담을 수 있어요": ["Up to {max} items", "最大{max}個まで追加できます", "最多可添加{max}个", "Tối đa {max} mục"],
  추가: ["Add", "追加", "添加", "Thêm"],
  선택: ["Optional", "任意", "选填", "Tùy chọn"],
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
  "추천 이유": ["Why we picked them", "おすすめの理由", "推荐理由", "Lý do gợi ý"],
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
