// Health information shown in the app. Verified against the listed Australian
// sources on GUIDANCE_CHECKED_ON. Re-check every source by GUIDANCE_REVIEW_DUE.

export const GUIDANCE_CHECKED_ON = '2026-11-01';
export const GUIDANCE_REVIEW_DUE = '2027-05-01';

export interface Source {
  title: string;
  publisher: string;
  url: string;
  sourceReviewed: string;
}

export const SOURCES: Record<string, Source> = {
  homeMonitoring: {
    title: 'Blood pressure monitoring at home',
    publisher: 'healthdirect Australia',
    url: 'https://www.healthdirect.gov.au/blood-pressure-monitoring-at-home',
    sourceReviewed: 'Page last reviewed December 2024',
  },
  highBP: {
    title: 'High blood pressure (hypertension)',
    publisher: 'healthdirect Australia',
    url: 'https://www.healthdirect.gov.au/high-blood-pressure-hypertension',
    sourceReviewed: 'Page last reviewed November 2024',
  },
  heartAttack: {
    title: 'Heart attack warning signs',
    publisher: 'Heart Foundation',
    url: 'https://www.heartfoundation.org.au/your-heart/heart-attack-warning-signs',
    sourceReviewed: 'Page last reviewed 7 January 2024 (updated 15 September 2026)',
  },
  stroke: {
    title: 'Signs of stroke',
    publisher: 'Stroke Foundation',
    url: 'https://strokefoundation.org.au/about-stroke/learn/signs-of-stroke',
    sourceReviewed: 'No review date shown on page (© 2026)',
  },
  racgpHome: {
    title: 'How to measure home blood pressure: recommendations for healthcare professionals and patients',
    publisher: 'Australian Family Physician (RACGP), 2016',
    url: 'https://www.racgp.org.au/afp/2016/januaryfebruary/how-to-measure-home-blood-pressure-recommendations-for-healthcare-professionals-and-patients/',
    sourceReviewed: 'Published January–February 2016',
  },
};

export const MEASUREMENT_STEPS: string[] = [
  'Use a validated automatic upper-arm monitor with a cuff that fits. Finger and wrist monitors are not recommended.',
  'Avoid caffeine and smoking for 30 minutes beforehand, and empty your bladder.',
  'Sit quietly for 5 minutes first: feet flat, legs uncrossed, back and arm supported, no talking.',
  'Put the cuff on your bare upper arm at heart level, with the bottom edge near your elbow.',
  'Take two readings one minute apart and record both.',
  'A common schedule is morning and evening at about the same times for 7 days (at least 5). Your doctor decides your schedule.',
  'healthdirect advises measuring before taking medicine, eating or exercising. Any extra after-medication readings should follow your clinician’s instructions.',
];

export const URGENT_SYMPTOMS: string[] = [
  'Chest pain, tightness or discomfort, or pain in the arm, shoulder, back, neck or jaw',
  'Shortness of breath',
  'Face drooping, arm weakness, or slurred or confused speech (stroke signs), even if they go away',
  'Sudden severe headache, or a headache at the back of the head with vomiting',
  'Sudden vision loss, blurring or eyesight problems',
  'Confusion or seizures',
  'Dizziness, loss of balance or an unexplained fall, with any of the above',
];

export const EMERGENCY = {
  number: '000',
  label: 'Triple Zero (000)',
  mobileNote: 'From a mobile you can also dial 112.',
  healthdirect: '1800 022 222',
  healthdirectLabel: 'healthdirect helpline (NURSE-ON-CALL in Victoria), 24 hours',
};

export const SAFETY_STATEMENT =
  'This app records personal information that you enter. It does not diagnose conditions, replace medical care, or provide continuous monitoring. ' +
  'It cannot contact emergency services, and it cannot guarantee that anyone will review your records.';

export const NO_NUMERIC_EMERGENCY_NOTE =
  'The Australian consumer guidance reviewed for this app does not give a blood pressure number that, on its own, means you should call 000. ' +
  'So the app does not raise emergency alerts from numbers alone. Urgent advice depends on symptoms, whatever the reading and whatever your personal targets.';
