import { useEffect, useState, type FormEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Icon } from "@/src/components/ui/icon";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";
import type { ProjectHost } from "../server";
import { RemotePathBrowser } from "./RemotePathBrowser";

function normalizeProjectPath(path: string): string {
  const trimmed = path.trim();
  return trimmed === "/" ? trimmed : trimmed.replace(/\/+$/, "");
}

function projectName(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (!normalized.startsWith("/") || normalized === "/") return "";
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function pathError(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  if (!normalized.startsWith("/")) return "Project path must be absolute.";
  if (normalized === "/") return "Choose a project directory, not the root.";
  return null;
}

export function ProjectPathDialog({
  open,
  pending,
  hosts,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  hosts: readonly ProjectHost[];
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (hostId: string, path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <ProjectPathDialogContent
            pending={pending}
            hosts={hosts}
            error={error}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProjectPathDialogContent({
  pending,
  hosts,
  error,
  onSubmit,
}: {
  pending: boolean;
  hosts: readonly ProjectHost[];
  error: string | null;
  onSubmit: (hostId: string, path: string) => void;
}) {
  const firstConnectedHostId = hosts.find(
    (host) => host.status === "connected",
  )?.id;
  const [selectedHostId, setSelectedHostId] = useState(
    firstConnectedHostId ?? null,
  );
  const [browserDirectory, setBrowserDirectory] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const selectedHost = hosts.find((host) => host.id === selectedHostId);
  const showMachinePicker = hosts.length > 1;
  const noMachineAvailable = showMachinePicker && selectedHostId === null;
  const derivedProjectName = browserDirectory
    ? projectName(browserDirectory)
    : "";

  useEffect(() => setValidationMessage(null), [browserDirectory]);
  useEffect(() => {
    if (selectedHostId === null && firstConnectedHostId) {
      setSelectedHostId(firstConnectedHostId);
    }
  }, [firstConnectedHostId, selectedHostId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !selectedHostId || !browserDirectory) return;
    const message = pathError(browserDirectory);
    if (message) {
      setValidationMessage(message);
      return;
    }
    onSubmit(selectedHostId, normalizeProjectPath(browserDirectory));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>
          {selectedHostId
            ? `Browse to the project folder${selectedHost?.name ? ` on ${selectedHost.name}` : ""}, or edit the path directly.`
            : noMachineAvailable
              ? "No machine is online. Start one to choose a project folder."
              : "Choose a project folder."}
        </DialogDescription>
      </DialogHeader>
      <form className="min-w-0 space-y-4" onSubmit={submit}>
        {showMachinePicker ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending}>
              <Button
                type="button"
                variant="outline"
                aria-label="Machine"
                disabled={pending}
                className="w-full justify-between font-normal"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selectedHost ? (
                    <MachineStatusDot
                      connected={selectedHost.status === "connected"}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {selectedHost?.name ?? "Select a machine"}
                  </span>
                </span>
                <Icon
                  name="ChevronDown"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              mobileTitle="Machine"
              className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
            >
              {hosts.map((host) => {
                const connected = host.status === "connected";
                return (
                  <DropdownMenuItem
                    key={host.id}
                    disabled={!connected}
                    className="flex items-center gap-2"
                    onSelect={() => {
                      if (!connected) return;
                      setSelectedHostId(host.id);
                      setBrowserDirectory(null);
                    }}
                  >
                    <MachineStatusDot connected={connected} />
                    <span className="min-w-0 flex-1 truncate">{host.name}</span>
                    {!connected ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Offline
                      </span>
                    ) : null}
                    <Icon
                      name="Check"
                      className={cn(
                        "size-4 shrink-0",
                        host.id === selectedHostId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {selectedHostId ? (
          <RemotePathBrowser
            key={selectedHostId}
            hostId={selectedHostId}
            onDirectoryChange={setBrowserDirectory}
            disabled={pending || selectedHost?.status !== "connected"}
          />
        ) : (
          <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
            Every machine is offline. Bring one online to browse its folders.
          </p>
        )}

        {derivedProjectName || validationMessage || error ? (
          <div className="space-y-1">
            {derivedProjectName ? (
              <p className="flex min-w-0 gap-1 text-sm text-muted-foreground">
                <span className="shrink-0">Project name:</span>
                <span className="min-w-0 truncate font-medium text-foreground">
                  {derivedProjectName}
                </span>
              </p>
            ) : null}
            {validationMessage ? (
              <p className="text-sm text-destructive">{validationMessage}</p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="submit"
            disabled={
              pending ||
              !browserDirectory ||
              selectedHost?.status !== "connected" ||
              noMachineAvailable
            }
          >
            Add project
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function MachineStatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        connected ? "bg-success" : "bg-muted-foreground/40",
      )}
    />
  );
}
