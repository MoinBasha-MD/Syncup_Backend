/**
 * Push text for Primary Time and Autobot in the user's app language (`user.language`), English when unset.
 * "Primary Time" and "Autobot" stay names in every language, as in the app's own translations.
 */
const TEXT = {
  en: {
    startedTitle: 'Primary Time Started',
    startedBody: '{status} is now active',
    endedTitle: 'Primary Time Ended',
    endedBody: '{status} has ended',
    upcomingBody: '"{status}" starts in {minutes} min',
    autobotUpcomingBody: 'Setting "{status}" in {minutes} min. Tap to see or skip it.',
    deferredBody: '"{busy}" is still on, so Autobot will set "{status}" when it ends.',
  },
  hi: {
    startedTitle: 'Primary Time शुरू हुआ',
    startedBody: '{status} अब चालू है',
    endedTitle: 'Primary Time खत्म हुआ',
    endedBody: '{status} खत्म हो गया',
    upcomingBody: '"{status}" {minutes} मिनट में शुरू होगा',
    autobotUpcomingBody: '{minutes} मिनट में "{status}" सेट होगा। देखने या छोड़ने के लिए टैप करें।',
    deferredBody: '"{busy}" अभी चालू है, इसलिए इसके खत्म होने पर Autobot "{status}" सेट करेगा।',
  },
  ta: {
    startedTitle: 'Primary Time தொடங்கியது',
    startedBody: '{status} இப்போது செயலில் உள்ளது',
    endedTitle: 'Primary Time முடிந்தது',
    endedBody: '{status} முடிந்தது',
    upcomingBody: '"{status}" {minutes} நிமிடத்தில் தொடங்கும்',
    autobotUpcomingBody: '{minutes} நிமிடத்தில் "{status}" அமைக்கப்படும். பார்க்க அல்லது தவிர்க்கத் தட்டவும்.',
    deferredBody: '"{busy}" இன்னும் செயலில் உள்ளது, அது முடிந்ததும் Autobot "{status}" அமைக்கும்.',
  },
  te: {
    startedTitle: 'Primary Time ప్రారంభమైంది',
    startedBody: '{status} ఇప్పుడు యాక్టివ్‌గా ఉంది',
    endedTitle: 'Primary Time ముగిసింది',
    endedBody: '{status} ముగిసింది',
    upcomingBody: '"{status}" {minutes} నిమిషాల్లో ప్రారంభమవుతుంది',
    autobotUpcomingBody: '{minutes} నిమిషాల్లో "{status}" సెట్ అవుతుంది. చూడటానికి లేదా దాటవేయడానికి నొక్కండి.',
    deferredBody: '"{busy}" ఇంకా కొనసాగుతోంది, అది ముగిసాక Autobot "{status}" సెట్ చేస్తుంది.',
  },
  ml: {
    startedTitle: 'Primary Time ആരംഭിച്ചു',
    startedBody: '{status} ഇപ്പോൾ സജീവമാണ്',
    endedTitle: 'Primary Time അവസാനിച്ചു',
    endedBody: '{status} അവസാനിച്ചു',
    upcomingBody: '"{status}" {minutes} മിനിറ്റിനുള്ളിൽ ആരംഭിക്കും',
    autobotUpcomingBody: '{minutes} മിനിറ്റിനുള്ളിൽ "{status}" സജ്ജമാക്കും. കാണാനോ ഒഴിവാക്കാനോ ടാപ്പ് ചെയ്യുക.',
    deferredBody: '"{busy}" ഇപ്പോഴും തുടരുന്നു, അത് കഴിയുമ്പോൾ Autobot "{status}" സജ്ജമാക്കും.',
  },
  kn: {
    startedTitle: 'Primary Time ಆರಂಭವಾಗಿದೆ',
    startedBody: '{status} ಈಗ ಸಕ್ರಿಯವಾಗಿದೆ',
    endedTitle: 'Primary Time ಮುಗಿದಿದೆ',
    endedBody: '{status} ಮುಗಿದಿದೆ',
    upcomingBody: '"{status}" {minutes} ನಿಮಿಷದಲ್ಲಿ ಆರಂಭವಾಗುತ್ತದೆ',
    autobotUpcomingBody: '{minutes} ನಿಮಿಷದಲ್ಲಿ "{status}" ಹೊಂದಿಸಲಾಗುತ್ತದೆ. ನೋಡಲು ಅಥವಾ ಬಿಟ್ಟುಬಿಡಲು ಟ್ಯಾಪ್ ಮಾಡಿ.',
    deferredBody: '"{busy}" ಇನ್ನೂ ಚಾಲ್ತಿಯಲ್ಲಿದೆ, ಅದು ಮುಗಿದಾಗ Autobot "{status}" ಹೊಂದಿಸುತ್ತದೆ.',
  },
};

// Placeholders are filled in one pass over the template, so a status that looks like "{minutes}" stays literal.
function primaryTimeText(language, key, values = {}) {
  const table = Object.hasOwn(TEXT, language) ? TEXT[language] : TEXT.en;
  return (table[key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

module.exports = { primaryTimeText, TEXT };
