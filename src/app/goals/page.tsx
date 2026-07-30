import { GoalsList } from "@/features/goals/goals-list";

export default function GoalsPage() {
  return (
    <main className="flex flex-col gap-6 py-8">
      <h1 className="text-title font-semibold text-ink">Goals</h1>
      <GoalsList />
    </main>
  );
}
