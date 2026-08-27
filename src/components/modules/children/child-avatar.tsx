import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Photo avatar with a tinted initials fallback. Works in server and client components. */
export function ChildAvatar({
  firstName,
  lastName,
  photoUrl,
  className,
}: {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9 ring-1 ring-border", className)}>
      {photoUrl && <AvatarImage src={photoUrl} alt={`${firstName} ${lastName}`} />}
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
        {initials(firstName, lastName)}
      </AvatarFallback>
    </Avatar>
  );
}
