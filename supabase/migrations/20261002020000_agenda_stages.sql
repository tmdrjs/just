-- =====================================================================
-- 안건 상태 확장: 토의 → 구현 → 테스트 추적
--
--   discussing(논의 중) → decided(확정) → in_progress(제작 중)
--   → in_studio(스튜디오 반영됨) → tested(테스트 완료)
--   on_hold(보류)는 어느 단계에서든 가능
--
-- 상태는 자유롭게 바꿀 수 있지만, 확정 이후 단계(decided / in_progress / in_studio / tested)는
-- 결론이 반드시 있어야 한다. 기존 값(discussing / decided / on_hold)은 그대로 유효하다.
-- =====================================================================

alter table public.agendas drop constraint if exists agendas_status_check;
alter table public.agendas add constraint agendas_status_check
  check (status in ('discussing', 'decided', 'in_progress', 'in_studio', 'tested', 'on_hold'));

alter table public.agendas drop constraint if exists agendas_decided_needs_conclusion;
alter table public.agendas drop constraint if exists agendas_conclusion_required;
alter table public.agendas add constraint agendas_conclusion_required
  check (
    status not in ('decided', 'in_progress', 'in_studio', 'tested')
    or coalesce(conclusion, '') ~ '\S'
  );
