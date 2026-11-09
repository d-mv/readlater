<script setup lang="ts">
import { onMounted, useId } from "vue";
import {
  describeEvent,
  SECURITY_EVENTS_SHOWN,
  useSecurityEvents,
} from "../../composables/useSecurityEvents";
import { shortDateTime } from "../../utils/format";
import Button from "../../shared/ui/Button.vue";
import Empty from "../../shared/ui/Empty.vue";
import Message from "../../shared/ui/Message.vue";

const { state, load } = useSecurityEvents();
const headingId = useId();

onMounted(load);
</script>

<template>
  <section
    data-testid="security-activity"
    :aria-labelledby="headingId"
    :aria-busy="state.status === 'loading'"
    class="mb-16 rounded-sm border border-line bg-raised p-20"
  >
    <h2 :id="headingId" class="label m-0 mb-12">Security activity</h2>
    <p class="m-0 mb-16 text-sm leading-[1.5] text-ink-muted">
      Sign-ins, new capture keys, sharing changes and deletes from the last 90 days. The newest
      {{ SECURITY_EVENTS_SHOWN }} are shown.
    </p>

    <Message v-if="state.status === 'loading'" test-id="security-activity-loading">
      Loading security activity…
    </Message>

    <template v-else-if="state.status === 'error'">
      <Message tone="danger" test-id="security-activity-error">{{ state.message }}</Message>
      <Button variant="secondary" test-id="security-activity-retry" class="mt-12" @click="load">
        Try again
      </Button>
    </template>

    <Empty v-else-if="state.events.length === 0" test-id="security-activity-empty" class="m-0">
      No activity yet
    </Empty>

    <ul v-else class="m-0 list-none p-0">
      <li
        v-for="event in state.events"
        :key="event.id"
        data-testid="security-event"
        :data-kind="event.kind"
        class="border-t border-line py-10 first:border-t-0 first:pt-0 last:pb-0"
      >
        <p data-testid="security-event-text" class="m-0 text-sm break-words text-ink">
          {{ describeEvent(event) }}
        </p>
        <time
          data-testid="security-event-date"
          :datetime="event.created_at"
          class="mt-2 block font-mono text-xs text-ink-faint"
          >{{ shortDateTime(event.created_at) }}</time
        >
      </li>
    </ul>
  </section>
</template>
