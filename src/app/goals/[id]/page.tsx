import { Separator } from "@/components/ui/separator";
import { GoalDetail } from "@/features/goals/goal-detail/goal-detail";
import { GoalEdit } from "@/features/goals/goal-edit";

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="flex flex-col gap-6 py-8">
      <GoalDetail goalId={id} />
      <Separator />
      <h2 className="text-title font-semibold text-ink">Edit goal</h2>
      <GoalEdit goalId={id} />
    </main>
  );
}
