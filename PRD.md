# PRD: 게임 기획 토의 웹사이트

## 1. 개요

공포게임을 함께 만드는 팀(기본 2명, 최대 3명)이 **텍스트로 실시간 대화하며 안건을 정리하고 결정**하는 웹사이트.
음성 대화는 Discord가 담당하므로 이 사이트는 다루지 않는다.

- 사용자: 최대 3명 (기본 2명), 4명 이상은 지원하지 않음
- 형태: 반응형 웹 (데스크톱 우선, 모바일에서도 사용 가능)
- 핵심 가치: "무슨 이야기를 했고, 무엇이 결정됐는지"가 한눈에 보이는 것
- 로그인(회원가입, 이메일, 비밀번호)은 없음. **초대 코드 + 닉네임**으로 입장하고, 멤버 자리 3개를 DB에서 관리한다.

## 2. 목표 / 비목표

### 목표
- 안건별로 대화가 분리된 실시간 채팅
- 접속 중인지, 입력 중인지 보이는 것
- 안건의 상태(논의 중 / 확정 / 보류)와 결론이 남는 것
- 중요한 의견을 핀으로 고정
- 초대 코드를 아는 최대 3명만 입장 가능 (서버에서 강제)

### 비목표 (1차 버전에서 제외)
- 이메일/비밀번호 로그인, 소셜 로그인
- 음성/화상 통화
- 파일 업로드, 이미지 첨부
- 할 일(태스크) 관리, 칸반
- AI 요약/정리 기능 (2차 후보)
- 4명 이상 팀 기능, 세분화된 권한 관리

## 3. 사용자 스토리

1. 처음 방문한 사용자는 초대 코드를 입력하고, 통과하면 닉네임을 입력해 멤버 자리 1개를 차지한다.
2. 자리 3개가 모두 차 있으면 새 사용자는 입장할 수 없고 "자리가 가득 찼어요" 안내를 본다.
3. 이미 등록된 사용자는 같은 브라우저로 다시 접속하면 코드/닉네임 입력 없이 바로 들어간다.
4. 브라우저 데이터를 지웠거나 다른 기기에서 접속하는 사용자는 초대 코드 입력 후 **기존 닉네임을 선택해 다시 연결**할 수 있다.
5. 사용자는 새 안건을 만들고 제목과 짧은 설명을 적을 수 있다.
6. 사용자는 안건을 선택해 그 안건 전용 채팅방에서 대화하고, 보낸 메시지는 상대 화면에 즉시 표시된다.
7. 사용자는 누가 접속 중인지, 누가 어떤 안건에서 입력 중인지 볼 수 있다.
8. 사용자는 중요한 메시지를 핀으로 고정해 안건 상단에서 다시 볼 수 있다.
9. 사용자는 안건 상태를 변경하고, "확정"으로 바꿀 때 한 줄 결론을 남길 수 있다.
10. 사용자는 안건 목록에서 상태별로 필터링하고, 안 읽은 메시지 표시를 볼 수 있다.
11. 사용자는 "방 나가기"로 자신의 자리를 비울 수 있다.

## 4. 기능 요구사항

### 4.1 입장 및 멤버 관리 (로그인 대체)

**방식**: Supabase 익명 로그인(Anonymous Sign-in) + 초대 코드 + 멤버 자리 3개.
사용자에게는 로그인 화면이 보이지 않고, 뒤에서 브라우저마다 내부 ID(`auth.uid()`)가 자동 생성된다.

**입장 흐름**
1. 사이트 접속 시 익명 세션이 없으면 자동으로 익명 로그인한다.
2. 현재 `members`에 내 ID가 있으면 바로 메인 화면으로 이동한다.
3. 없으면 입장 화면(초대 코드 + 닉네임 입력)을 보여준다.
4. 제출하면 서버 함수 `join_room(code, nickname)`을 호출한다.
5. 성공하면 `members`에 등록되고 메인 화면으로 이동한다.

**`join_room(code, nickname)` 규칙 (Postgres 함수, `security definer`)**
- 초대 코드가 틀리면 실패한다 (코드는 해시로 저장하고 클라이언트가 읽을 수 없어야 한다).
- 이미 내 ID가 멤버면 그대로 성공 처리한다.
- 현재 멤버가 3명 이상이면 `ROOM_FULL` 에러로 실패한다.
- 닉네임이 중복이면 실패한다 (공백 제거 후 1~12자).
- **동시에 여러 명이 입장해도 4명이 되지 않도록** 함수 안에서 락(`pg_advisory_xact_lock` 또는 `select ... for update`)을 걸어 검사와 삽입을 한 트랜잭션에서 처리한다.
- 이 검사는 반드시 DB 함수에서 하고, 프론트엔드에서만 막지 않는다.

**기존 닉네임으로 다시 연결: `reclaim_member(code, nickname)`**
- 초대 코드가 맞고, 해당 닉네임의 멤버가 존재하면, 그 멤버의 `user_id`를 현재 익명 ID로 교체한다.
- 입장 화면에서 자리가 가득 찬 경우 "기존 멤버로 다시 연결하기" 선택지를 보여준다.
- 한계: 초대 코드를 아는 사람은 누구의 닉네임이든 가져갈 수 있다. 친구끼리 쓰는 서비스라 허용하며, 이 한계를 UI나 문서에 명시한다.

**방 나가기: `leave_room()`**
- 내 멤버 행을 삭제해 자리를 비운다. 내가 쓴 메시지는 유지하고, 작성자는 닉네임이 보존된 상태로 표시한다 (`messages.sender_nickname` 스냅샷 컬럼, 또는 `members`를 삭제하지 않고 `left_at`으로 표시하는 방식 중 구현이 단순한 쪽을 선택).

**보안 요구사항**
- 초대 코드는 8자 이상의 무작위 문자열로 하고, 코드 시도 횟수를 제한한다 (익명 ID당 / 짧은 시간 내 실패 횟수를 DB에 기록하고 초과 시 일정 시간 차단).
- Supabase 대시보드에서 Anonymous Sign-ins를 활성화하고, 가능하면 CAPTCHA(Turnstile 등)를 켠다.
- 초대 코드는 코드 저장소/환경변수에 평문으로 올리지 않는다. 초기 코드는 Supabase SQL 편집기에서 해시로 직접 등록한다.
- 멤버가 아닌 익명 세션은 `members`를 제외한 모든 테이블에 접근할 수 없다 (RLS).

### 4.2 안건 (Agenda)
- 생성 / 수정 / 삭제(소프트 삭제 권장)
- 필드: 제목, 설명, 상태, 결론, 생성자, 생성일
- 상태: `discussing`(논의 중) / `decided`(확정) / `on_hold`(보류)
- `decided`로 변경 시 결론 입력 필수 (한 줄, 최대 200자)
- 목록은 최근 활동순 정렬, 상태별 필터

### 4.3 채팅
- 안건별 메시지 목록, 오래된 것이 위, 새 메시지는 아래에 추가
- Supabase Realtime으로 새 메시지 즉시 반영
- Enter 전송, Shift+Enter 줄바꿈
- 본인 메시지 수정/삭제 가능 (수정됨 표시)
- 새 메시지 도착 시 하단 자동 스크롤 (사용자가 위로 스크롤한 상태면 "새 메시지" 버튼 표시)
- 날짜 구분선 표시
- 작성자별로 닉네임과 색상을 구분해 표시 (최대 3명이라 고정 팔레트 3색 사용)

### 4.4 접속 / 입력 중 표시
- Supabase Realtime **Presence**: 현재 접속 중인 멤버와 현재 보고 있는 안건 표시 (최대 3명)
- Supabase Realtime **Broadcast**: "OOO 입력 중..." (3초 동안 입력 없으면 해제), 2명 이상이 동시에 입력하면 "OOO, OOO 입력 중..."
- 안건 목록에서 다른 멤버가 현재 보고 있는 안건에 표시 (예: 닉네임 색상 점)
- Presence 키는 `auth.uid()`를 사용하고, 같은 사용자가 탭을 여러 개 열어도 1명으로 집계한다.

### 4.5 핀 고정
- 메시지에 핀 토글
- 핀된 메시지는 채팅 상단 접이식 영역에 모아서 표시, 클릭 시 원본 위치로 이동
- 안건당 핀 개수 제한 없음 (필요 시 추후 제한)

### 4.6 읽음 표시
- 안건별 "마지막으로 읽은 시각"을 멤버별로 저장
- 안건 목록에서 안 읽은 메시지 수 배지 표시

## 5. 화면 구성

3단 레이아웃 (모바일에서는 한 번에 한 패널만 보이고 탭/드로어로 전환)

| 영역 | 내용 |
|---|---|
| 왼쪽 | 안건 목록, 상태 필터, "새 안건" 버튼, 안 읽은 배지, 다른 멤버 위치 표시 |
| 가운데 | 안건 제목, 핀 고정 영역, 메시지 목록, 입력 중 표시, 입력창 |
| 오른쪽 | 안건 상태 변경, 결론 입력/표시, 안건 설명, 접속 중인 멤버 목록 (최대 3명) |

화면 목록: 입장(초대 코드 + 닉네임), 자리 가득 참 안내(+ 기존 멤버 다시 연결), 메인(3단 레이아웃), 안건 생성/수정 모달, 결론 입력 모달, 설정(닉네임 확인, 방 나가기)

## 6. 기술 스택

- **프레임워크**: Next.js (App Router) + TypeScript
- **스타일**: Tailwind CSS (필요 시 shadcn/ui)
- **백엔드**: Supabase (Postgres, Anonymous Auth, Realtime, RPC 함수)
- **배포**: Vercel
- **상태 관리**: React 기본 상태 + 필요 시 Zustand 정도로 단순하게

## 7. 데이터 모델 (Postgres)

```sql
-- 멤버 (익명 auth 사용자와 1:1, 최대 3행)
members (
  user_id uuid primary key references auth.users on delete cascade,
  nickname text not null unique,
  joined_at timestamptz default now()
)

-- 방 설정 (클라이언트 접근 불가, 함수에서만 사용)
room_settings (
  id int primary key default 1 check (id = 1),
  invite_code_hash text not null,
  max_members int not null default 3
)

-- 초대 코드 시도 기록 (무차별 대입 방지)
join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  succeeded boolean not null,
  created_at timestamptz default now()
)

-- 안건
agendas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'discussing'
    check (status in ('discussing','decided','on_hold')),
  conclusion text,
  created_by uuid references members(user_id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
)

-- 메시지
messages (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references agendas(id) on delete cascade,
  sender_id uuid not null references members(user_id),
  content text not null,
  is_pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now()
)

-- 읽음 상태
agenda_reads (
  agenda_id uuid references agendas(id) on delete cascade,
  user_id uuid references members(user_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (agenda_id, user_id)
)
```

**RPC 함수**: `join_room(code, nickname)`, `reclaim_member(code, nickname)`, `leave_room()`, `get_member_list()` (자리 가득 참 화면에서 다시 연결할 닉네임 목록 제공, 코드 검증 후에만 반환)

**기타 설정**
- `messages`, `agendas`에 Realtime 활성화
- 인덱스: `messages(agenda_id, created_at)`
- **RLS**
  - `room_settings`, `join_attempts`: 클라이언트 접근 전부 차단 (함수에서만 접근)
  - `members`: 멤버만 조회 가능, 직접 insert/update/delete는 금지 (반드시 RPC 경유)
  - `agendas`, `messages`, `agenda_reads`: `auth.uid()`가 `members`에 존재할 때만 읽기/쓰기 가능
  - 메시지 수정/삭제는 `sender_id = auth.uid()`인 경우만

## 8. 비기능 요구사항

- 메시지 전송 후 상대 화면 반영까지 체감 1초 이내
- 연결이 끊기면 상단에 "연결 끊김" 표시, 재연결 시 놓친 메시지 자동 동기화
- 메시지 전송 실패 시 재시도 버튼 표시 (낙관적 UI 사용 시)
- 환경변수로 Supabase URL / anon key 관리, 서비스 롤 키는 클라이언트에 노출 금지
- 자리 제한은 DB에서 강제하며, 동시 입장 상황에서도 4명이 되면 안 된다.

## 9. 마일스톤

1. **M1 기반**: 프로젝트 세팅, Supabase 연결, 익명 로그인, 테이블/RLS 생성
2. **M2 입장 시스템**: `join_room`, 초대 코드 해시 검증, 3자리 제한(락 포함), 입장 화면, 자리 가득 참 화면
3. **M3 안건**: 안건 CRUD, 목록, 3단 레이아웃 뼈대
4. **M4 실시간 채팅**: 메시지 전송/수신, 자동 스크롤, 수정/삭제
5. **M5 상태 표시**: Presence(접속/보고 있는 안건), 입력 중 표시
6. **M6 결정 기능**: 안건 상태 변경, 결론 입력, 핀 고정
7. **M7 마무리**: 기존 멤버 다시 연결, 방 나가기, 읽음 배지, 코드 시도 제한, 반응형, 연결 끊김 처리, Vercel 배포

## 10. 완료 기준 (수락 조건)

- 초대 코드를 모르는 사람은 입장할 수 없고, `members` 외 모든 데이터에 접근할 수 없다.
- 3명이 입장하면 4번째 사람은 올바른 코드를 입력해도 `ROOM_FULL`로 거절된다. 여러 명이 동시에 입장을 시도해도 멤버는 3명을 넘지 않는다.
- 같은 브라우저로 재방문하면 코드 입력 없이 바로 메인 화면에 들어간다.
- 브라우저 데이터를 지운 뒤 초대 코드와 기존 닉네임으로 다시 연결하면 기존 자리를 이어서 쓸 수 있다.
- "방 나가기" 후 자리가 비워져 새 사람이 들어올 수 있다.
- 두 명 이상이 각자 브라우저에서 접속해 한쪽이 보낸 메시지가 다른 쪽에 새로고침 없이 나타난다.
- 한쪽이 입력 중일 때 다른 쪽에 입력 중 표시가 뜨고, 멈추면 사라진다.
- 안건을 "확정"으로 바꾸려면 결론을 입력해야 하며, 결론이 목록과 오른쪽 패널에 보인다.
- 핀한 메시지가 새로고침 후에도 안건 상단에 유지된다.
- Vercel 배포 URL로 친구가 접속해 위 항목을 모두 사용할 수 있다.

## 11. 2차 후보 (이번 범위 아님)

- 안건 대화 AI 요약 및 결론 초안 제안
- 메시지 이모지 리액션, 간이 투표
- 이미지/레퍼런스 링크 첨부
- 확정된 안건만 모아 보는 "기획 문서" 뷰 내보내기
- 초대 코드 변경 기능

## 12. Claude Code 작업 안내

- 마일스톤(M1~M7) 순서대로, 한 번에 하나씩 구현하고 각 단계마다 동작을 확인한다.
- 먼저 Supabase 마이그레이션 SQL(테이블, RLS, RPC 함수, Realtime 설정)을 작성하고, 그다음 프론트엔드를 만든다.
- 사용자가 직접 해야 하는 설정(Supabase 프로젝트 생성, Anonymous Sign-ins 활성화, 초대 코드 해시 등록)은 필요한 시점에 단계별로 안내한다.
- 3자리 제한과 초대 코드 검증은 반드시 DB 함수에서 처리하고, 프론트엔드 검사에만 의존하지 않는다.
- 구현 중 이 문서와 어긋나는 결정이 필요하면 임의로 바꾸지 말고 먼저 질문한다.
