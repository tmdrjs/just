"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  createAgenda,
  deleteAgenda,
  deleteMessage,
  leaveRoom,
  selectAgenda,
  updateAgenda,
} from "@/lib/actions";
import {
  CONCLUSION_MAX,
  DESCRIPTION_MAX,
  memberColor,
  STATUS_LABEL,
  TITLE_MAX,
} from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { buildChildren, flattenTree, selfAndDescendants } from "@/lib/tree";
import { closeModal, showToast, useRoom } from "@/lib/store";
import type { AgendaStatus, Message } from "@/lib/types";
import { Button, Spinner } from "../ui/Button";
import { Label, TextArea, TextInput } from "../ui/Field";
import { Modal } from "../ui/Modal";

export function Modals({ onLeft }: { onLeft: () => void }) {
  const modal = useRoom((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case "agenda":
      return (
        <AgendaFormModal
          key={modal.agendaId ?? `new:${modal.parentId ?? ""}`}
          agendaId={modal.agendaId}
          initialParentId={modal.parentId}
        />
      );
    case "conclusion":
      return <ConclusionModal agendaId={modal.agendaId} status={modal.status} />;
    case "deleteAgenda":
      return <DeleteAgendaModal agendaId={modal.agendaId} />;
    case "deleteMessage":
      return <DeleteMessageModal message={modal.message} />;
    case "settings":
      return <SettingsModal onLeft={onLeft} />;
  }
}

function AgendaFormModal({ agendaId, initialParentId }: { agendaId?: string; initialParentId?: string }) {
  const existing = useRoom((s) => (agendaId ? s.agendas[agendaId] : undefined));
  const agendas = useRoom((s) => s.agendas);
  // 새로 만들 때는 상위가 이미 정해져 있다: 노드의 + → 그 안건의 하위, 빈 곳 더블클릭 → 최상위
  const parentTitle = initialParentId ? agendas[initialParentId]?.title : undefined;
  const [parentId, setParentId] = useState<string | null>(
    existing ? existing.parent_id : (initialParentId ?? null),
  );
  // 자기 자신과 하위 안건은 상위로 고를 수 없다 (DB 트리거도 같은 규칙으로 막는다)
  const parentOptions = useMemo(() => {
    const flat = flattenTree(agendas);
    if (!agendaId) return flat;
    const excluded = selfAndDescendants(agendaId, buildChildren(agendas).children);
    return flat.filter((x) => !excluded.has(x.agenda.id));
  }, [agendas, agendaId]);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(agendaId);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const input = {
      title: t,
      description: description.trim() || null,
      parent_id: parentId,
    };
    if (isEdit && agendaId) {
      const ok = await updateAgenda(agendaId, input);
      setBusy(false);
      if (ok) closeModal();
    } else {
      const created = await createAgenda(input);
      setBusy(false);
      if (created) {
        closeModal();
        // 모바일에서 마인드맵 화면에서 만든 경우 마인드맵에 머문다
        const stay = useRoom.getState().panel === "list";
        selectAgenda(created.id);
        if (stay) useRoom.setState({ panel: "list" });
      }
    }
  }

  return (
    <Modal
      title={isEdit ? "안건 수정" : initialParentId ? "새 하위 안건" : "새 안건"}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            취소
          </Button>
          <Button variant="primary" disabled={!title.trim() || busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : isEdit ? "저장" : "만들기"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!isEdit && (
          <p className="-mt-1 truncate text-xs text-muted">
            {initialParentId ? (
              <>
                <b className="font-medium text-sub">{parentTitle ?? "선택한 안건"}</b> 의 하위 안건으로 만들어요.
              </>
            ) : (
              "최상위 안건으로 만들어요."
            )}
          </p>
        )}
        <div>
          <Label hint={`${title.length}/${TITLE_MAX}`}>제목</Label>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder="예: 주인공이 깨어나는 첫 장소"
            required
          />
        </div>
        <div>
          <Label hint={`${description.length}/${DESCRIPTION_MAX}`}>짧은 설명 (선택)</Label>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="무엇을 정해야 하는지, 배경이나 선택지를 적어 두세요."
          />
        </div>
        {/* 상위 안건 변경은 수정할 때만 (마인드맵에서 위치를 옮기는 유일한 방법) */}
        {isEdit && (
          <div>
            <Label hint="선택 안 하면 최상위">상위 안건</Label>
            <select
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-fg outline-none focus:border-accent/70"
            >
              <option value="">없음 (최상위 안건)</option>
              {parentOptions.map(({ agenda, depth }) => (
                <option key={agenda.id} value={agenda.id}>
                  {"\u00a0\u00a0\u00a0".repeat(depth) + (depth ? "└ " : "") + agenda.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** status 가 있으면 그 상태로 바꾸면서 결론 입력, 없으면 결론만 수정 */
function ConclusionModal({ agendaId, status }: { agendaId: string; status?: AgendaStatus }) {
  const agenda = useRoom((s) => s.agendas[agendaId]);
  const [conclusion, setConclusion] = useState(agenda?.conclusion ?? "");
  const [busy, setBusy] = useState(false);
  if (!agenda) return null;
  const editingOnly = !status;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const c = conclusion.trim();
    if (!c || busy) return;
    setBusy(true);
    const ok = await updateAgenda(agendaId, status ? { status, conclusion: c } : { conclusion: c });
    setBusy(false);
    if (ok) {
      closeModal();
      if (status) showToast(`'${STATUS_LABEL[status]}' 단계로 바꿨어요 ✅`);
    }
  }

  return (
    <Modal
      title={editingOnly ? "결론 수정" : status === "decided" ? "확정하기" : `'${STATUS_LABEL[status]}'(으)로 변경`}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            취소
          </Button>
          <Button variant="primary" disabled={!conclusion.trim() || busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : editingOnly ? "저장" : status === "decided" ? "확정" : "변경"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-sub">
          <b className="text-fg">{agenda.title}</b>
          {editingOnly
            ? " 의 결론을 고쳐요."
            : status === "decided"
              ? " 을(를) 확정하려면 한 줄 결론이 필요해요."
              : ` 을(를) '${STATUS_LABEL[status]}'(으)로 바꾸려면 먼저 한 줄 결론이 필요해요. 확정 이후 단계는 결론이 꼭 있어야 해요.`}
        </p>
        <div>
          <Label hint={`${conclusion.length}/${CONCLUSION_MAX}`}>결론 (한 줄)</Label>
          <TextInput
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value.replace(/\n/g, " "))}
            maxLength={CONCLUSION_MAX}
            placeholder="예: 첫 장소는 폐병원 지하 영안실로 한다"
            required
          />
        </div>
      </form>
    </Modal>
  );
}

function DeleteAgendaModal({ agendaId }: { agendaId: string }) {
  const agenda = useRoom((s) => s.agendas[agendaId]);
  const [busy, setBusy] = useState(false);
  if (!agenda) return null;
  return (
    <Modal
      title="안건 삭제"
      size="sm"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            취소
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            data-autofocus
            onClick={async () => {
              setBusy(true);
              const ok = await deleteAgenda(agendaId);
              setBusy(false);
              if (ok) closeModal();
            }}
          >
            {busy ? <Spinner /> : "삭제"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-sub">
        <b className="text-fg">{agenda.title}</b> 안건과 그 대화가 목록에서 사라져요. 모든 멤버에게 적용돼요.
      </p>
    </Modal>
  );
}

function DeleteMessageModal({ message }: { message: Message }) {
  return (
    <Modal
      title="메시지 삭제"
      size="sm"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            취소
          </Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              closeModal();
              void deleteMessage(message.id);
            }}
          >
            삭제
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-sub">이 메시지를 삭제할까요? 되돌릴 수 없어요.</p>
      <p className="line-clamp-4 rounded-lg border border-line bg-bg px-3 py-2 text-sm break-words whitespace-pre-wrap text-muted">
        {message.content}
      </p>
    </Modal>
  );
}

function SettingsModal({ onLeft }: { onLeft: () => void }) {
  const me = useRoom((s) => s.members[s.userId]);
  const count = useRoom((s) => Object.keys(s.members).length);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="설정" size="sm" onClose={closeModal}>
      <div className="flex flex-col gap-5">
        <section>
          <Label>내 닉네임</Label>
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-bg px-3 py-2.5">
            <span className="size-2.5 rounded-full" style={{ background: memberColor(me?.slot) }} />
            <span className="font-medium" style={{ color: memberColor(me?.slot) }}>
              {me?.nickname}
            </span>
            {me && <span className="ml-auto text-[11px] text-muted">{formatDate(me.joined_at)} 입장</span>}
          </div>
          <p className="mt-2 text-xs text-muted">현재 멤버 {count}/3명</p>
        </section>

        <section className="rounded-lg border border-line bg-bg px-3 py-3 text-xs leading-relaxed text-muted">
          <p className="mb-1 font-medium text-sub">다른 기기에서 쓰려면</p>
          그 기기에서 초대 코드를 입력하고 <b className="text-sub">기존 멤버로 다시 연결하기</b>로 내 닉네임을
          고르세요. 그러면 이 브라우저는 연결이 해제돼요.
          <p className="mt-2">
            ⚠️ 초대 코드를 아는 사람은 누구의 닉네임이든 가져갈 수 있어요 (친구끼리 쓰는 방이라 허용).
          </p>
        </section>

        <section>
          {!confirming ? (
            <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>
              방 나가기
            </Button>
          ) : (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
              <p className="text-sm text-sub">
                정말 나갈까요? 내 자리가 비워져 다른 사람이 들어올 수 있어요. 내가 쓴 메시지는 닉네임과 함께
                남아요.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  취소
                </Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await leaveRoom();
                    setBusy(false);
                    if (!ok) return showToast("나가지 못했어요. 잠시 후 다시 시도해 주세요.");
                    closeModal();
                    onLeft();
                  }}
                >
                  {busy ? <Spinner /> : "나가기"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
