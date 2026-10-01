import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  ArrowUpDownIcon,
  BubbleChatAddIcon,
  Cancel01Icon,
  CancelCircleIcon,
  CircleIcon,
  DashedLineCircleIcon,
  Delete02Icon,
  Edit02Icon,
  FileEmpty02Icon,
  FolderAddIcon,
  FolderIcon,
  HelpCircleIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  Tick02Icon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

const ICONS = {
  ArrowUp: ArrowUp02Icon,
  ArrowUpDown: ArrowUpDownIcon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronRight: ArrowRight01Icon,
  Circle: CircleIcon,
  CircleQuestion: HelpCircleIcon,
  CircleX: CancelCircleIcon,
  Edit: Edit02Icon,
  EyeOff: ViewOffIcon,
  File: FileEmpty02Icon,
  Folder: FolderIcon,
  FolderPlus: FolderAddIcon,
  Loading: Loading03Icon,
  MessageSquarePlus: BubbleChatAddIcon,
  MoreHorizontal: MoreHorizontalIcon,
  Pin: PinIcon,
  PinOff: PinOffIcon,
  Spinner: DashedLineCircleIcon,
  Trash2: Delete02Icon,
  X: Cancel01Icon,
} as const satisfies Record<string, IconSvgElement>;

interface IconProps {
  name: keyof typeof ICONS;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

export function Icon({
  name,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
