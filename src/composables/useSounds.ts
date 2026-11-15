import { ref, watch } from 'vue'

type Sound = 'entryClick' | 'entryAdded' | 'branch' | 'error' | 'off' | 'on' | 'moved' | 'focus' | 'room' | 'tick'
const files: Record<Sound, string> = {
  entryClick: 'click-with-big-reverb-28848-01.mp3',
  entryAdded: 'bing-298405.mp3',
  branch: 'happy-pop-2-185287.mp3',
  error: 'obacht.mp3',
  off: 'ui-sound-off-270300.mp3',
  on: 'ui-sound-on-270295.mp3',
  moved: 'droplets-in-a-cave-6785-01.mp3',
  focus: 'intro-sound-1-269293.mp3',
  room: 'intro-sound-2-269294.mp3',
  tick: 'tick-single.mp3',
}

export function useSounds() {
  const saved = Number(localStorage.getItem('canopy-volume') ?? '1')
  const volume = ref(Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 1)
  const muted = ref(localStorage.getItem('canopy-muted') === 'true')
  watch(volume, (value) => localStorage.setItem('canopy-volume', String(value)))
  watch(muted, (value) => localStorage.setItem('canopy-muted', String(value)))
  function play(sound: Sound, allowMuted = false) {
    if (muted.value && !allowMuted) return
    const audio = new Audio(`${import.meta.env.BASE_URL}sounds/${files[sound]}`)
    audio.volume = volume.value
    void audio.play().catch((error: unknown) => console.warn('Sound playback failed', error))
  }
  function toggleMute() {
    if (muted.value) {
      muted.value = false
      play('on')
    } else {
      play('off')
      muted.value = true
    }
  }
  function ping() {
    if (muted.value || volume.value === 0) return
    try {
      const context = new window.AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(660, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.11)
      gain.gain.setValueAtTime(0.12 * volume.value, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001 * volume.value, context.currentTime + 0.12)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.12)
      oscillator.onended = () => { void context.close().catch((error: unknown) => console.warn('Audio close failed', error)) }
      if (context.state === 'suspended') void context.resume().catch((error: unknown) => console.warn('Audio resume failed', error))
    } catch (error) {
      console.warn('Ping audio failed', error)
    }
  }
  return { volume, muted, play, ping, toggleMute }
}
