# 공포게임 기획실

공포게임을 함께 만드는 팀(최대 3명)이 **안건별로 텍스트 대화를 나누고 결정을 남기는** 웹사이트.
기획 문서는 [`PRD.md`](./PRD.md) 참고.

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase: Postgres, 익명 로그인, Realtime(Postgres Changes / Presence / Broadcast), RPC 함수
- 로그인 없음. **초대 코드 + 닉네임**으로 입장하고, 자리 3개는 DB 함수가 관리

## 처음 설정 (한 번만)

### 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com) 에서 새 프로젝트를 만든다.
2. **Authentication → Sign In / Providers → Anonymous sign-ins** 를 켠다.
3. **SQL Editor** 에서 [`supabase/migrations/`](./supabase/migrations/) 의 파일을 **이름 순서대로** 하나씩 붙여넣고 실행한다.
   - `20261002000000_init.sql`: 테이블, RLS, RPC 함수, 트리거, Realtime 설정
   - `20261002020000_agenda_stages.sql`: 안건 상태 확장 (제작 중 / 스튜디오 반영됨 / 테스트 완료)
4. 초대 코드를 등록한다.
   ```bash
   node scripts/generate-invite-code.mjs
   ```
   출력된 SQL 을 SQL Editor 에서 실행하고, 실행 후 편집기에서 지운다.
   코드를 바꾸고 싶을 때도 같은 SQL 을 다시 실행하면 된다 ([`supabase/set-invite-code.sql`](./supabase/set-invite-code.sql)).
5. (권장) **Authentication → Attack Protection** 에서 CAPTCHA(Cloudflare Turnstile)를 켜고,
   같은 사이트 키를 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 로 넣는다.

### 2. 로컬 실행

```bash
cp .env.example .env.local   # URL 과 publishable(anon) key 입력
npm install
npm run dev
```

http://localhost:3000 접속 → 초대 코드 + 닉네임 입력.

### 3. Vercel 배포

1. 이 폴더를 GitHub 저장소로 올리고 Vercel 에서 Import 한다 (또는 `npx vercel`).
2. Vercel 프로젝트 **Settings → Environment Variables** 에 `.env.local` 과 같은 값을 넣는다.
3. 배포 URL 을 친구에게 초대 코드와 함께 보낸다.

## 동작 방식 요약

| 항목 | 방식 |
|---|---|
| 입장 | 익명 세션 자동 생성 → `join_room(code, nickname)` RPC. 코드는 bcrypt 해시로만 저장 |
| 3자리 제한 | `join_room` 안에서 `pg_advisory_xact_lock` 으로 직렬화 + `members.slot`(1~3, unique) 제약으로 이중 보장 |
| 시도 제한 | 익명 ID당 10분에 5번 실패하면 차단, 전체 10분에 30번 실패하면 모두 잠시 차단 |
| 재방문 | 같은 브라우저면 저장된 익명 세션으로 바로 입장 |
| 다시 연결 | `reclaim_member(code, nickname)` 이 그 멤버의 `user_id` 를 현재 세션으로 교체 (메시지 등은 `on update cascade`) |
| 방 나가기 | `leave_room()` 이 멤버 행 삭제. 메시지는 `sender_nickname` 스냅샷으로 작성자 유지 |
| 권한 | 멤버만 `agendas` / `messages` / `agenda_reads` 접근(RLS). 컬럼 단위 권한으로 작성자·시각 위조 불가 |
| 실시간 | `room:db` 채널(Postgres Changes), `room:live` 채널(Presence 접속·보는 안건, Broadcast 입력 중). 둘 다 private 채널이라 멤버만 구독 |

### PRD 대비 구현상 추가한 것

- `members.slot` (1~3): 멤버 색상 고정 + DB 제약으로 최대 3명 이중 보장
- `messages.sender_nickname`: 방을 나간 사람의 메시지 작성자 표시 (PRD 4.1의 스냅샷 방식)
- `agendas.last_activity_at`: "최근 활동순" 정렬용 (안건 수정·새 메시지 시 갱신)
- 핀 토글은 작성자와 무관하게 멤버 누구나 가능하도록 `set_message_pinned` RPC 로 처리
- 읽음 처리는 `mark_agenda_read`, 안 읽은 수는 `get_unread_counts` RPC

## 알려진 한계

- **초대 코드를 아는 사람은 누구의 닉네임이든 가져갈 수 있다** (`reclaim_member`). 친구끼리 쓰는 방이라 허용하며 입장 화면과 설정에 안내한다.
- 한 사람이 두 기기를 동시에 쓸 수는 없다. 다른 기기에서 다시 연결하면 원래 기기는 연결이 해제된다.
- 익명 ID를 계속 새로 만드는 공격에 대비한 전체 실패 제한(10분 30회) 때문에, 공격이 있으면 새 입장도 잠시 막힐 수 있다 (이미 들어온 멤버는 영향 없음).
