<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { actionIcons } from '../config/icons'

type StoryStep = {
  title: string; text?: string; image?: string; imageAlt?: string
  list?: { ordered: boolean; items: string[] }; highlight?: string; instruction?: string
  completion?: { event: string; selector: string }; action?: { label: string; selector: string }
}
const props = defineProps<{ story: { title: string; steps: StoryStep[] }; rightInset?: number }>()
const emit = defineEmits<{ close: [] }>()
const { close: Close } = actionIcons
const baseUrl = import.meta.env.BASE_URL
const index = ref(0)
const complete = ref(false)
const message = ref('')
const bounds = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const step = computed(() => props.story.steps[index.value]!)
function updateHighlight() {
  const element = step.value.highlight ? document.querySelector(step.value.highlight) : null
  const rect = element?.getBoundingClientRect()
  bounds.value = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
}
function advance() {
  if (index.value + 1 < props.story.steps.length) index.value++
  else emit('close')
}
function restart() { index.value = 0; complete.value = false; message.value = '' }
function handleAction() {
  const element = step.value.action && document.querySelector<HTMLElement>(step.value.action.selector)
  if (element) element.click()
  else message.value = 'The requested control is not currently available.'
}
function handleClick(event: MouseEvent) {
  const condition = step.value.completion
  if (condition?.event === 'click' && event.target instanceof Element && event.target.closest(condition.selector)) complete.value = true
}
watch(index, () => { complete.value = false; message.value = ''; void nextTick(updateHighlight) })
onMounted(() => {
  document.addEventListener('click', handleClick, true)
  window.addEventListener('resize', updateHighlight)
  window.addEventListener('scroll', updateHighlight, true)
  void nextTick(updateHighlight)
})
onUnmounted(() => {
  document.removeEventListener('click', handleClick, true)
  window.removeEventListener('resize', updateHighlight)
  window.removeEventListener('scroll', updateHighlight, true)
})
</script>

<template>
  <div v-if="bounds" class="story-highlight" :style="{ top: `${bounds.top}px`, left: `${bounds.left}px`, width: `${bounds.width}px`, height: `${bounds.height}px` }"></div>
  <section class="story-guide entry-editor" role="dialog" :aria-label="story.title"
    :style="rightInset ? { right: `${rightInset}px` } : undefined" @keydown.esc.stop="emit('close')">
    <div class="editor-heading"><span class="section-label">{{ story.title }} · {{ index + 1 }} / {{ story.steps.length }}</span>
      <button type="button" class="quiet-icon" aria-label="Exit tutorial" @click="emit('close')"><Close :size="17" /></button></div>
    <h2>{{ step.title }}</h2>
    <p v-if="step.text">{{ step.text }}</p>
    <img v-if="step.image" class="story-image" :src="`${baseUrl}${step.image}`" :alt="step.imageAlt || ''" />
    <component :is="step.list.ordered ? 'ol' : 'ul'" v-if="step.list">
      <li v-for="item in step.list.items" :key="item">{{ item }}</li>
    </component>
    <p v-if="step.instruction">{{ step.instruction }}</p>
    <button v-if="step.action" type="button" class="cancel-button" @click="handleAction">{{ step.action.label }}</button>
    <p v-if="message" role="alert">{{ message }}</p>
    <div class="editor-actions">
      <button type="button" class="cancel-button" @click="restart">Restart</button>
      <button type="button" class="cancel-button" @click="emit('close')">Skip</button>
      <button type="button" class="cancel-button" :disabled="index === 0" @click="index--">Previous</button>
      <button type="button" class="primary-button" :disabled="!!step.completion && !complete" @click="advance">{{ index === story.steps.length - 1 ? 'Finish' : 'Next' }}</button>
    </div>
  </section>
</template>
