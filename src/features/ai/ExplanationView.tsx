import type { Explanation } from '../../services/ai/business';

export function ExplanationView({ explanation, references }: {
  explanation: Explanation;
  references: Array<{ factId: string; label?: string; source: string }>;
}) {
  return <div className="space-y-4 text-sm break-words">
    <p className="whitespace-pre-wrap">{explanation.summary}</p>
    {explanation.observations.map((observation, index) => <div key={index} className="border-l-2 border-emerald-500 pl-3">
      <p className="whitespace-pre-wrap">{observation.text}</p>
      <details className="mt-1 text-xs text-slate-500"><summary>查看事实引用（{observation.factIds.length}）</summary>
        <ul className="mt-2 space-y-1">{observation.factIds.map(id => {
          const reference = references.find(ref => ref.factId === id);
          return <li key={id}><span className="font-medium">{reference?.label ?? id}</span><br />{reference?.source ?? '引用不可用'}</li>;
        })}</ul>
      </details>
    </div>)}
    {explanation.limitations.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-amber-800"><p className="font-medium">解读限制</p><ul className="mt-1 list-disc pl-4 space-y-1">{explanation.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <p className="text-xs text-slate-500">模型生成的解释可能有误。引用只证明数据来源；变化原因需由你结合实际情况核对。</p>
  </div>;
}
