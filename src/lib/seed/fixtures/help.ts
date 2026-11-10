import { blocks } from '../richText';
import type { HelpArticleFixture } from '../types';

// Plain demo text. Ramble is a demo marketplace and no real money moves, so each answer says what
// the site does, not what a real company promises. Voice follows docs/design/tone-checklist.md:
// plain on money and rules, no exclamation marks.

export const helpArticles: HelpArticleFixture[] = [
  {
    slug: 'is-my-session-still-on',
    title: 'Is my session still on?',
    summary: 'How weather and host cancellations work, and how you hear.',
    position: 10,
    status: 'published',
    body: blocks(
      'Almost always, yes. Outdoor experiences are the ones that can change, and each one says on its page how the host decides and how many hours before the start you will hear.',
      { heading: 'If the weather turns' },
      'The host makes the call by the time their page states. If they cancel, you get a full refund and an email telling you.',
      { heading: 'If a host cancels' },
      'You are refunded in full, whatever the reason.',
      { heading: 'Where to check' },
      'Your confirmation email carries a private link to your booking. It shows the current status, so you can look there on the morning.',
    ),
  },
  {
    slug: 'how-to-cancel-a-booking',
    title: 'How do I cancel a booking?',
    summary:
      'Use the link in your confirmation email, and read the dates first.',
    position: 20,
    status: 'published',
    body: blocks(
      'Open the link in your confirmation email and choose Cancel. You do not need an account.',
      { heading: 'What you get back' },
      'Every experience states its cancellation terms with a real date and time before you pay, and again at the last step. The page you cancel from shows the same dates and the amount you would get back, before you confirm.',
      { heading: 'Lost the email' },
      'Ask for it again from the contact page. Give us the name and email you booked with.',
    ),
  },
  {
    slug: 'where-to-meet-my-host',
    title: 'Where do I meet my host?',
    summary: 'The meeting point is on the experience page and in your email.',
    position: 30,
    status: 'published',
    body: blocks(
      'The meeting point is written on the experience page, under the description, and repeated in your confirmation email. It is a specific spot, such as a dock or a doorway, not just a neighborhood.',
      { heading: 'Running late' },
      'Groups are small and hosts start on time. If you will be late, tell us from the contact page as early as you can and we will reach your host.',
      { heading: 'Can not find them' },
      'Check the meeting note once more, then write to us from the contact page. We will reach the host.',
    ),
  },
  {
    slug: 'do-i-need-an-account',
    title: 'Do I need an account to book?',
    summary: 'No. Your email is how you get back to your booking.',
    position: 40,
    status: 'published',
    body: blocks(
      'No. You can book with a name and an email. After you book, your confirmation email carries a private link to your booking.',
      { heading: 'Keep that email' },
      'The link is how you cancel, check the status, or find the meeting point. Anyone with the link can open the booking, so forward it only to people you trust.',
      { heading: 'Newsletter' },
      'Booking does not sign you up for the newsletter. There is a box for it at checkout, and it starts unticked.',
    ),
  },
  {
    slug: 'how-gifts-work',
    title: 'How do gifts work?',
    summary: 'Give a specific experience, with a message and a day to send it.',
    position: 50,
    status: 'published',
    body: blocks(
      'Pick an experience, write a message, and choose the day the gift arrives. The person you give it to chooses a session that suits them.',
      { heading: 'Changing your mind' },
      'The same cancellation terms apply as for any booking. They are shown with the gift before you pay.',
      { heading: 'When gifts are paused' },
      'Gifting can be switched off for a while. When it is, the gift option does not show.',
    ),
  },
  {
    slug: 'waivers-age-rules-and-what-to-bring',
    title: 'Waivers, age rules, and what to bring',
    summary: 'Where to find what a host asks of you before you book.',
    position: 60,
    status: 'published',
    body: blocks(
      'Each experience lists its age rule, what is included, and what to bring. Read them before you pay; they are part of the booking.',
      { heading: 'Waivers' },
      'Some hosts, such as those on the water, ask you to accept a waiver. It is linked from the booking steps and you accept it before paying.',
      { heading: 'Children' },
      'An age rule says who may take part and whether an adult needs a ticket. If it says an adult stays and does not need one, they stay for free.',
    ),
  },
  {
    slug: 'is-an-experience-accessible',
    title: 'Is an experience accessible for me?',
    summary: 'Hosts describe access on each page. Ask us if it is unclear.',
    position: 70,
    status: 'published',
    body: blocks(
      'Each experience page has an access note from the host, such as ramps, stairs, or how much mobility the activity needs. We do not visit every location, so the note is the host’s own account.',
      { heading: 'If a note is missing or unclear' },
      'Write to us from the contact page before you book. We will ask the host and answer you.',
      { heading: 'This website' },
      'The accessibility page says how the site itself is built and where it falls short.',
    ),
  },
  {
    slug: 'what-demo-means',
    title: 'What does demo mean on Ramble?',
    summary: 'Ramble is a demo marketplace, so no real money moves.',
    position: 80,
    status: 'published',
    body: blocks(
      'Ramble is a demo marketplace built to show how a booking site can work. The experiences, hosts, and help text are made up for the demo.',
      { heading: 'Payments' },
      'The payment step is a stand-in. No card is charged and no money moves, and a booking here does not hold a real place with a real host.',
      { heading: 'Your details' },
      'Do not type anything private you would not want in a demo. Use made-up details if you prefer.',
    ),
  },
];
