-- =====================================================================
-- 초대 코드 등록 / 변경
--
-- 1) 아래 '여기에-초대-코드' 를 실제 코드로 바꿔서 Supabase SQL Editor 에서 실행한다.
--    (코드는 8자 이상 무작위 문자열. `node scripts/generate-invite-code.mjs` 로 만들 수 있다.)
-- 2) DB에는 bcrypt 해시만 저장되고, 클라이언트는 이 테이블을 읽을 수 없다.
-- 3) 실행한 뒤 SQL Editor 탭/스니펫에 남은 평문 코드는 지워 둔다.
--    이 파일에 실제 코드를 적은 채로 저장소에 올리지 않는다.
-- =====================================================================

insert into public.room_settings (id, invite_code_hash, max_members)
values (1, extensions.crypt('여기에-초대-코드', extensions.gen_salt('bf', 10)), 3)
on conflict (id) do update set invite_code_hash = excluded.invite_code_hash;
