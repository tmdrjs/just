// 초대 코드 생성기: 헷갈리는 글자(0/O, 1/I/L)를 뺀 10자 무작위 코드를 만든다.
// 사용법: node scripts/generate-invite-code.mjs
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;

console.log(`\n초대 코드: ${code}\n`);
console.log("Supabase SQL Editor 에서 아래를 실행하세요 (실행 후 편집기에서 지우기):\n");
console.log(
  `insert into public.room_settings (id, invite_code_hash, max_members)
values (1, extensions.crypt('${code}', extensions.gen_salt('bf', 10)), 3)
on conflict (id) do update set invite_code_hash = excluded.invite_code_hash;\n`,
);
