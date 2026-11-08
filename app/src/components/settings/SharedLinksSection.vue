<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useId } from "vue";
import { IconCopy, IconCopyCheck } from "@tabler/icons-vue";
import { useSharedLinks, type SharedLink } from "../../composables/useSharedLinks";
import { copyText } from "../../utils/clipboard";
import { shortDate } from "../../utils/format";
import Button from "../../shared/ui/Button.vue";
import Empty from "../../shared/ui/Empty.vue";
import IconButton from "../../shared/ui/IconButton.vue";
import Message from "../../shared/ui/Message.vue";

export interface SharedLinksSectionProps {
  // Origin the public /s/:id links are built on; the current page's by default.
  origin?: string;
}

const props = withDefaults(defineProps<SharedLinksSectionProps>(), { origin: undefined });

const { state, revoking, revokeError, load, revoke } = useSharedLinks();
const headingId = useId();

const COPIED_MS = 2000;
const copiedId = shallowRef<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function publicUrl(id: string): string {
  return `${props.origin ?? window.location.origin}/s/${id}`;
}

function label(link: SharedLink): string {
  return link.title || link.url || "Untitled";
}

async function onCopy(id: string) {
  await copyText(publicUrl(id));
  copiedId.value = id;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copiedId.value = null), COPIED_MS);
}

onMounted(load);
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <section
    data-testid="shared-links"
    :aria-labelledby="headingId"
    :aria-busy="state.status === 'loading'"
    class="mb-16 rounded-sm border border-line bg-raised p-20"
  >
    <h2 :id="headingId" class="label m-0 mb-12">Shared links</h2>
    <p class="m-0 mb-16 text-sm leading-[1.5] text-ink-muted">
      Bookmarks anyone with the link can read. Revoking a link makes the bookmark private again; it
      keeps the same link if you share it later.
    </p>

    <Message v-if="state.status === 'loading'" test-id="shared-links-loading">
      Loading shared links…
    </Message>

    <template v-else-if="state.status === 'error'">
      <Message tone="danger" test-id="shared-links-error">{{ state.message }}</Message>
      <Button variant="secondary" test-id="shared-links-retry" class="mt-12" @click="load">
        Try again
      </Button>
    </template>

    <Empty v-else-if="state.links.length === 0" test-id="shared-links-empty" class="m-0">
      Nothing is shared
    </Empty>

    <ul v-else class="m-0 list-none p-0">
      <li
        v-for="link in state.links"
        :key="link.id"
        data-testid="shared-link"
        :data-id="link.id"
        class="flex flex-col gap-10 border-t border-line py-12 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
      >
        <div class="min-w-0 flex-1">
          <p data-testid="shared-link-title" class="m-0 truncate text-base text-ink">
            {{ label(link) }}
          </p>
          <p data-testid="shared-link-date" class="m-0 mt-2 font-mono text-xs text-ink-faint">
            Saved {{ shortDate(link.created_at) }}
          </p>
          <a
            data-testid="shared-link-url"
            :href="publicUrl(link.id)"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-4 block truncate font-mono text-xs text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
            >{{ publicUrl(link.id) }}</a
          >
        </div>
        <div class="flex shrink-0 items-center gap-8">
          <IconButton
            :title="`Copy link to ${label(link)}`"
            test-id="shared-link-copy"
            class="h-34 w-34"
            @click="onCopy(link.id)"
          >
            <IconCopyCheck v-if="copiedId === link.id" :size="18" />
            <IconCopy v-else :size="18" />
          </IconButton>
          <Button
            variant="secondary"
            test-id="shared-link-revoke"
            :disabled="revoking.has(link.id)"
            @click="revoke(link.id)"
          >
            {{ revoking.has(link.id) ? "Revoking…" : "Revoke"
            }}<span class="sr-only"> link to {{ label(link) }}</span>
          </Button>
        </div>
      </li>
    </ul>

    <span role="status" data-testid="shared-links-status" class="sr-only">{{
      copiedId ? "Link copied" : ""
    }}</span>
    <Message v-if="revokeError" tone="danger" test-id="shared-links-revoke-error" class="mt-12">
      {{ revokeError }}
    </Message>
  </section>
</template>
