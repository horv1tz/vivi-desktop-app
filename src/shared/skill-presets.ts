/**
 * A small library of ready-made skills offered as a shortcut when creating a new one — text
 * only, so (unlike `mcp-presets.ts`) nothing here needs external verification: picking one just
 * prefills the New skill form, which the user can still edit before saving, same as typing it
 * from scratch. Bodies are authored in both UI languages since, unlike a preset's picker label,
 * the body becomes real content the user keeps and reads.
 */
export interface SkillPreset {
  id: string
  name: string
  description: string
  body: { en: string; ru: string }
}

export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: 'daily-briefing',
    name: 'Daily briefing style',
    description: 'A consistent shape for morning summaries and routine check-ins.',
    body: {
      en: "When giving a daily briefing or morning summary, structure it in this order: 1) today's calendar/schedule if known, 2) anything urgent or time-sensitive, 3) one thing worth double-checking, 4) a short closing note. Keep the whole thing under 150 words (or under 30 seconds if spoken aloud) — this is a quick orientation, not a full report.",
      ru: 'Для утренней сводки/брифинга используй такой порядок: 1) расписание на сегодня, если известно, 2) срочное или горящее, 3) что стоит перепроверить, 4) короткая финальная фраза. Уложись в 150 слов (или 30 секунд, если ответ голосовой) — это быстрая ориентировка, а не полный отчёт.',
    },
  },
  {
    id: 'code-review-checklist',
    name: 'Code review checklist',
    description: 'A fixed order of checks and a short prioritized-list format for reviews.',
    body: {
      en: 'When reviewing a code change (a diff, a PR, or files just edited), check in this order: correctness and edge cases, obvious security issues (secrets in code, injection, unsafe input handling), whether tests cover the change, and whether any docs/comments now need updating. Report findings as a short prioritized list — most serious first — not a paragraph of prose.',
      ru: 'При ревью изменений в коде (diff, PR или только что отредактированные файлы) проверяй в таком порядке: корректность и граничные случаи, очевидные проблемы безопасности (секреты в коде, инъекции, небезопасная обработка ввода), покрыты ли изменения тестами, нужно ли обновить документацию/комментарии. Оформляй находки как короткий список по приоритету — сначала самое серьёзное, а не сплошным текстом.',
    },
  },
  {
    id: 'summarize-documents',
    name: 'Meeting & document summaries',
    description: 'A fixed three-part shape (TLDR, decisions, open questions), strictly factual.',
    body: {
      en: "When summarizing a document, article, or meeting transcript, produce exactly three parts: a one-paragraph TLDR, a bulleted list of key decisions/action items (with an owner if one is mentioned), and a short list of open questions. Stay strictly factual — don't speculate or add opinions beyond what the source actually says.",
      ru: 'При суммаризации документа, статьи или расшифровки встречи делай ровно три части: TLDR одним абзацем, список ключевых решений/задач (с исполнителем, если он назван), короткий список открытых вопросов. Строго придерживайся фактов из источника — не додумывай и не добавляй своих оценок.',
    },
  },
  {
    id: 'file-organization',
    name: 'Downloads/desktop file organization',
    description: 'Ask once with a plan instead of per file; only rename genuinely unhelpful names.',
    body: {
      en: 'When asked to tidy up a folder like Downloads or Desktop, first list the planned moves (grouped by type: Documents, Images, Archives, Installers, Other) and ask for confirmation once — not per file. Rename only files whose current name is genuinely unhelpful (e.g. "IMG_2341.jpg", "download (3).pdf"), based on their actual content or date, and leave clearly-named files alone.',
      ru: 'Если просят навести порядок в папке вроде Downloads или Desktop, сначала перечисли планируемые перемещения (по группам: Документы, Изображения, Архивы, Установщики, Прочее) и спроси подтверждение один раз — не на каждый файл отдельно. Переименовывай только файлы с действительно бесполезным именем (например, «IMG_2341.jpg», «download (3).pdf»), опираясь на их содержимое или дату, и не трогай файлы с понятными именами.',
    },
  },
  {
    id: 'screenshot-before-diagnosing',
    name: 'Screenshot before diagnosing',
    description: 'Look at the screen before explaining an error, even if not explicitly asked to.',
    body: {
      en: 'When asked to help with something currently on screen (an error message, a confusing UI, "why isn\'t this working") and no recent screenshot exists in this conversation, take one before answering — even if not explicitly asked to look. Guessing what\'s on screen from the description alone leads to wrong answers more often than it saves time.',
      ru: 'Если просят помочь с тем, что сейчас на экране (сообщение об ошибке, непонятный интерфейс, «почему это не работает»), и в этом разговоре ещё нет свежего скриншота — сделай его перед ответом, даже если явно не просили посмотреть. Угадывать содержимое экрана по описанию чаще приводит к неверному ответу, чем экономит время.',
    },
  },
  {
    id: 'explain-before-running',
    name: 'Explain before running unfamiliar commands',
    description: 'A one-line "what and why" before commands, on top of the normal risk dialog.',
    body: {
      en: "Before running a terminal command the user didn't type themselves verbatim, say in one short line what it does and why — especially if it's unfamiliar, touches many files, or isn't easily undone. This is on top of the normal confirmation dialog for risky commands: it's about clarity for routine ones too, not just safety for dangerous ones.",
      ru: 'Перед выполнением команды в терминале, которую пользователь не написал сам дословно, кратко (одной строкой) объясни, что она делает и зачем — особенно если команда незнакомая, затрагивает много файлов или её трудно отменить. Это дополняет обычный диалог подтверждения для опасных команд — речь именно о ясности и для обычных команд, а не только о безопасности для опасных.',
    },
  },
]
