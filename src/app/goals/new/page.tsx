import { GoalForm } from "@/features/goals/goal-form";

export default function NewGoalPage() {
  return (
    <main className="flex flex-col gap-6 py-8">
      <h1 className="text-title font-semibold text-ink">New goal</h1>
      <GoalForm />
    </main>
  );
}
