import { GoalEdit } from "@/features/goals/goal-edit";

export default async function EditGoalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="flex flex-col gap-6 py-8">
      <h1 className="text-title font-semibold text-ink">Edit goal</h1>
      <GoalEdit goalId={id} />
    </main>
  );
}
