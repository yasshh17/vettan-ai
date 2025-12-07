"use client"

interface ActiveChatHeaderProps {
  title: string | null
  isVisible: boolean
}

export function ActiveChatHeader({ title, isVisible }: ActiveChatHeaderProps) {


  if (!isVisible || !title) return null;

  return (
    <div className="mb-6 border-b border-neutral-800 pb-4">
      <h1 className="text-2xl font-semibold text-neutral-100 truncate">
        {title}
      </h1>
    </div>
  );
}