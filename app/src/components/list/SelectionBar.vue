<script setup lang="ts">
import { computed, useId, type Component } from "vue";
import {
  IconArchive,
  IconArchiveOff,
  IconDownload,
  IconMailOpened,
  IconTrash,
} from "@tabler/icons-vue";
import Button from "../../shared/ui/Button.vue";
import { cn } from "../../shared/clsx";

export interface SelectionBarProps {
  // Selected rows still listed.
  count: number;
  // The Archived tab: Unarchive takes Archive's place.
  archivedTab: boolean;
  // The list is the offline snapshot: every action writes to the server.
  offline: boolean;
  // A write is in flight.
  busy: boolean;
  // Selected rows each action applies to (unread; unread without a copy).
  markReadCount: number;
  saveOfflineCount: number;
  allSelected: boolean;
}

export interface SelectionBarEmits {
  (e: "archive"): void;
  (e: "unarchive"): void;
  (e: "delete"): void;
  (e: "markRead"): void;
  (e: "saveOffline"): void;
  (e: "selectAll"): void;
  (e: "cancel"): void;
}

const props = defineProps<SelectionBarProps>();
const emit = defineEmits<SelectionBarEmits>();

const reasonId = useId();

interface Action {
  testId: string;
  label: string;
  icon: Component;
  run: () => void;
  enabled: boolean;
  danger?: boolean;
}

const actions = computed<Action[]>(() => {
  const any = props.count > 0;
  return [
    props.archivedTab
      ? {
          testId: "bulk-unarchive",
          label: "Unarchive",
          icon: IconArchiveOff,
          run: () => emit("unarchive"),
          enabled: any,
        }
      : {
          testId: "bulk-archive",
          label: "Archive",
          icon: IconArchive,
          run: () => emit("archive"),
          enabled: any,
        },
    {
      testId: "bulk-mark-read",
      label: "Mark read",
      icon: IconMailOpened,
      run: () => emit("markRead"),
      enabled: props.markReadCount > 0,
    },
    {
      testId: "bulk-save-offline",
      label: "Save offline",
      icon: IconDownload,
      run: () => emit("saveOffline"),
      enabled: props.saveOfflineCount > 0,
    },
    {
      testId: "bulk-delete",
      label: "Delete",
      icon: IconTrash,
      run: () => emit("delete"),
      enabled: any,
      danger: true,
    },
  ];
});
</script>

<template>
  <!-- Fixed to the bottom, above the home indicator. data-bottom-bar sets
       --bottom-bar-height (main.css): the list pads its end by it, and the
       undo toast rises above the bar instead of covering it. -->
  <section
    aria-label="Selection"
    data-testid="selection-bar"
    data-bottom-bar
    class="fixed inset-x-0 bottom-0 z-40 flex justify-center"
  >
    <div
      class="flex h-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] w-full max-w-640 flex-col border-t border-line-strong bg-raised px-16 pt-8 pb-[calc(8px+env(safe-area-inset-bottom))] sm:border-x"
    >
      <div class="flex h-40 shrink-0 items-center gap-8">
        <div class="min-w-0 flex-1">
          <p data-testid="selection-count" aria-live="polite" class="num m-0 text-sm text-ink">
            {{ props.count }} selected
          </p>
          <p
            v-if="props.offline"
            :id="reasonId"
            data-testid="selection-offline"
            class="m-0 truncate font-sans text-xs text-ink-muted"
          >
            Offline — these need a connection.
          </p>
        </div>
        <Button
          variant="secondary"
          test-id="select-all"
          class="h-32 px-10"
          :disabled="props.allSelected"
          @click="emit('selectAll')"
        >
          Select all
        </Button>
        <Button
          variant="secondary"
          test-id="selection-cancel"
          class="h-32 px-10"
          @click="emit('cancel')"
        >
          Cancel
        </Button>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-4 gap-4">
        <button
          v-for="action in actions"
          :key="action.testId"
          type="button"
          :data-testid="action.testId"
          :disabled="!action.enabled || props.busy || props.offline"
          :aria-describedby="props.offline ? reasonId : undefined"
          :class="
            cn(
              'flex cursor-pointer flex-col items-center justify-center gap-4 rounded-sm border-0 bg-transparent px-2 font-mono text-2xs leading-[normal] tracking-meta text-ink uppercase hover:enabled:bg-recessed disabled:cursor-default disabled:opacity-40',
              action.danger && 'text-danger',
            )
          "
          @click="action.run()"
        >
          <component :is="action.icon" :size="18" aria-hidden="true" />
          <span class="max-w-full truncate">{{ action.label }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
