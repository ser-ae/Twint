/**
 * ReserveHold — translations.
 *
 * Loaded before app.js. Every user-visible string lives here so the widget
 * can be shown in DE / FR / IT / EN, which a Swiss TWINT product needs.
 *
 * Placeholders are written as {name} and filled in by t() in app.js.
 * To add a language: copy the "en" block, translate the values, and add the
 * language code to RW_LANGS below.
 */
window.RW_LANGS = ["de", "fr", "it", "en"];

window.RW_I18N = {
  de: {
    lang_name: "Deutsch",
    header_sub: "Tisch reservieren",
    steps_label: "Buchungsschritte",
    lang_switch: "Sprache",

    step_1: "Datum & Zeit",
    step_2: "Personenzahl",
    step_3: "Ihre Angaben",
    step_4: "Reservation sichern",

    legend_1: "Datum & Zeit",
    legend_2: "Personenzahl",
    legend_3: "Ihre Angaben",
    legend_4: "Tisch sichern",

    label_date: "Datum",
    label_time: "Uhrzeit",
    time_placeholder: "Zeit wählen",
    slots_loading: "Verfügbare Zeiten werden geladen…",
    slots_empty: "An diesem Tag sind keine Zeiten mehr frei. Bitte wählen Sie ein anderes Datum.",
    slots_offline: "Verfügbarkeit konnte nicht geprüft werden. Angezeigte Zeiten sind ohne Gewähr.",

    guests_group: "Anzahl Gäste",
    guests_decrease: "Weniger Gäste",
    guests_increase: "Mehr Gäste",
    guests_hint: "Grössere Gruppen ({max}+)? Bitte kontaktieren Sie das Restaurant direkt.",

    label_name: "Vollständiger Name",
    label_email: "E-Mail",
    label_phone: "Mobilnummer",
    label_notes: "Anmerkungen",
    optional: "(optional)",
    notes_placeholder: "Allergien, Kinderstuhl, besonderer Anlass…",
    phone_placeholder: "+41 79 000 00 00",

    fee_suffix: "Vorautorisierung – keine Belastung",
    fee_body:
      "Wir hinterlegen eine temporäre Vorautorisierung auf Ihrer Karte oder Ihrem TWINT-Konto, um diesen Tisch zu sichern. Sie wird nach Ihrer Reservationszeit automatisch freigegeben. Eine Belastung erfolgt nur, wenn das Restaurant die Reservation als Nichterscheinen markiert.",

    payment_group: "Zahlungsmittel",
    pay_twint: "TWINT",
    pay_twint_desc: "Mit der TWINT-App bezahlen",
    pay_card: "Karte",
    pay_card_desc: "Visa · Mastercard · Apple Pay",
    slot_twint: "TWINT: Sie werden weitergeleitet, um die Vorautorisierung in Ihrer TWINT-App zu bestätigen.",
    slot_card: "Karte: Die Kartenfelder werden hier sicher eingeblendet.",

    btn_back: "Zurück",
    btn_continue: "Weiter",
    btn_confirm: "Bestätigen & sichern",
    btn_working: "Wird verarbeitet…",

    legal:
      "Mit dem Fortfahren akzeptieren Sie die {policy}. Gebühr bei Nichterscheinen: {fee} pro Reservation – nur fällig, wenn Sie weder stornieren noch erscheinen. Wie wir Ihre Daten verwenden, steht in der {privacy}.",
    legal_policy: "Stornierungsbedingungen",
    legal_privacy: "Datenschutzerklärung",

    conf_title: "Tisch reserviert",
    conf_body: "Eine Bestätigung wurde an {email} gesendet.",
    conf_ref: "Referenz",
    conf_when: "Wann",
    conf_guests: "Gäste",
    conf_guests_value: "{n} Personen",
    conf_manage: "Reservation ansehen oder stornieren",
    conf_pending_title: "Zahlung wird geprüft…",
    conf_pending_body: "Bitte schliessen Sie dieses Fenster nicht. Das dauert nur einen Moment.",

    err_required: "Bitte füllen Sie dieses Feld aus.",
    err_email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    err_phone: "Bitte geben Sie eine gültige Mobilnummer ein, z. B. +41 79 000 00 00.",
    err_date_past: "Bitte wählen Sie ein Datum ab heute.",
    err_date_far: "Reservationen sind nur bis {date} möglich.",
    err_time: "Bitte wählen Sie eine Uhrzeit.",
    err_slot_gone: "Diese Zeit wurde soeben vergeben. Bitte wählen Sie eine andere.",
    err_network: "Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.",
    err_generic: "Die Reservation konnte nicht gesichert werden. Bitte versuchen Sie es erneut.",
    err_payment: "Die Zahlung wurde nicht abgeschlossen. Ihr Tisch ist nicht reserviert.",
  },

  fr: {
    lang_name: "Français",
    header_sub: "Réserver une table",
    steps_label: "Étapes de réservation",
    lang_switch: "Langue",

    step_1: "Date & heure",
    step_2: "Nombre de personnes",
    step_3: "Vos coordonnées",
    step_4: "Garantir la table",

    legend_1: "Date & heure",
    legend_2: "Nombre de personnes",
    legend_3: "Vos coordonnées",
    legend_4: "Garantir la table",

    label_date: "Date",
    label_time: "Heure",
    time_placeholder: "Choisir une heure",
    slots_loading: "Chargement des horaires disponibles…",
    slots_empty: "Plus aucun horaire disponible ce jour-là. Merci de choisir une autre date.",
    slots_offline: "Impossible de vérifier les disponibilités. Les horaires affichés sont sans garantie.",

    guests_group: "Nombre de convives",
    guests_decrease: "Moins de convives",
    guests_increase: "Plus de convives",
    guests_hint: "Groupes de {max} personnes ou plus ? Merci de contacter directement le restaurant.",

    label_name: "Nom complet",
    label_email: "E-mail",
    label_phone: "Numéro de mobile",
    label_notes: "Remarques",
    optional: "(facultatif)",
    notes_placeholder: "Allergies, chaise haute, occasion spéciale…",
    phone_placeholder: "+41 79 000 00 00",

    fee_suffix: "préautorisation – pas un débit",
    fee_body:
      "Nous plaçons une préautorisation temporaire sur votre carte ou votre compte TWINT afin de garantir cette table. Elle est libérée automatiquement après l'heure de votre réservation. Vous n'êtes débité que si le restaurant signale une absence.",

    payment_group: "Moyen de paiement",
    pay_twint: "TWINT",
    pay_twint_desc: "Payer avec l'app TWINT",
    pay_card: "Carte",
    pay_card_desc: "Visa · Mastercard · Apple Pay",
    slot_twint: "TWINT : vous serez redirigé pour confirmer la préautorisation dans votre app TWINT.",
    slot_card: "Carte : les champs de paiement s'afficheront ici de manière sécurisée.",

    btn_back: "Retour",
    btn_continue: "Continuer",
    btn_confirm: "Confirmer et garantir",
    btn_working: "Traitement en cours…",

    legal:
      "En continuant, vous acceptez les {policy}. Frais d'absence : {fee} par réservation – dus uniquement si vous n'annulez pas et ne vous présentez pas. L'usage de vos données est décrit dans la {privacy}.",
    legal_policy: "conditions d'annulation",
    legal_privacy: "politique de confidentialité",

    conf_title: "Table réservée",
    conf_body: "Une confirmation a été envoyée à {email}.",
    conf_ref: "Référence",
    conf_when: "Quand",
    conf_guests: "Convives",
    conf_guests_value: "{n} personnes",
    conf_manage: "Voir ou annuler la réservation",
    conf_pending_title: "Vérification du paiement…",
    conf_pending_body: "Merci de ne pas fermer cette fenêtre. Cela ne prend qu'un instant.",

    err_required: "Merci de remplir ce champ.",
    err_email: "Merci d'indiquer une adresse e-mail valide.",
    err_phone: "Merci d'indiquer un numéro de mobile valide, par ex. +41 79 000 00 00.",
    err_date_past: "Merci de choisir une date à partir d'aujourd'hui.",
    err_date_far: "Les réservations sont possibles jusqu'au {date}.",
    err_time: "Merci de choisir une heure.",
    err_slot_gone: "Cet horaire vient d'être pris. Merci d'en choisir un autre.",
    err_network: "Pas de connexion au serveur. Vérifiez votre connexion internet et réessayez.",
    err_generic: "La réservation n'a pas pu être garantie. Merci de réessayer.",
    err_payment: "Le paiement n'a pas abouti. Votre table n'est pas réservée.",
  },

  it: {
    lang_name: "Italiano",
    header_sub: "Prenota un tavolo",
    steps_label: "Fasi della prenotazione",
    lang_switch: "Lingua",

    step_1: "Data e ora",
    step_2: "Numero di persone",
    step_3: "I tuoi dati",
    step_4: "Conferma il tavolo",

    legend_1: "Data e ora",
    legend_2: "Numero di persone",
    legend_3: "I tuoi dati",
    legend_4: "Conferma il tavolo",

    label_date: "Data",
    label_time: "Ora",
    time_placeholder: "Seleziona un orario",
    slots_loading: "Caricamento degli orari disponibili…",
    slots_empty: "Non ci sono più orari liberi in questa data. Scegli un altro giorno.",
    slots_offline: "Impossibile verificare la disponibilità. Gli orari mostrati non sono garantiti.",

    guests_group: "Numero di ospiti",
    guests_decrease: "Meno ospiti",
    guests_increase: "Più ospiti",
    guests_hint: "Gruppi di {max} o più persone? Contatta direttamente il ristorante.",

    label_name: "Nome e cognome",
    label_email: "E-mail",
    label_phone: "Numero di cellulare",
    label_notes: "Note",
    optional: "(facoltativo)",
    notes_placeholder: "Allergie, seggiolone, occasione speciale…",
    phone_placeholder: "+41 79 000 00 00",

    fee_suffix: "preautorizzazione – non è un addebito",
    fee_body:
      "Applichiamo una preautorizzazione temporanea sulla tua carta o sul tuo conto TWINT per garantire il tavolo. Viene rilasciata automaticamente dopo l'orario della prenotazione. L'addebito avviene solo se il ristorante segnala una mancata presentazione.",

    payment_group: "Metodo di pagamento",
    pay_twint: "TWINT",
    pay_twint_desc: "Paga con l'app TWINT",
    pay_card: "Carta",
    pay_card_desc: "Visa · Mastercard · Apple Pay",
    slot_twint: "TWINT: verrai reindirizzato per confermare la preautorizzazione nella tua app TWINT.",
    slot_card: "Carta: i campi di pagamento appariranno qui in modo sicuro.",

    btn_back: "Indietro",
    btn_continue: "Continua",
    btn_confirm: "Conferma e garantisci",
    btn_working: "Elaborazione in corso…",

    legal:
      "Continuando accetti le {policy}. Penale per mancata presentazione: {fee} per prenotazione – dovuta solo se non annulli e non ti presenti. L'uso dei tuoi dati è descritto nell'{privacy}.",
    legal_policy: "condizioni di cancellazione",
    legal_privacy: "informativa sulla privacy",

    conf_title: "Tavolo prenotato",
    conf_body: "Una conferma è stata inviata a {email}.",
    conf_ref: "Riferimento",
    conf_when: "Quando",
    conf_guests: "Ospiti",
    conf_guests_value: "{n} persone",
    conf_manage: "Vedi o annulla la prenotazione",
    conf_pending_title: "Verifica del pagamento…",
    conf_pending_body: "Non chiudere questa finestra. Ci vuole solo un momento.",

    err_required: "Compila questo campo.",
    err_email: "Inserisci un indirizzo e-mail valido.",
    err_phone: "Inserisci un numero di cellulare valido, ad es. +41 79 000 00 00.",
    err_date_past: "Scegli una data da oggi in poi.",
    err_date_far: "Le prenotazioni sono possibili fino al {date}.",
    err_time: "Seleziona un orario.",
    err_slot_gone: "Questo orario è appena stato occupato. Scegline un altro.",
    err_network: "Nessuna connessione al server. Controlla la tua connessione e riprova.",
    err_generic: "Non è stato possibile confermare la prenotazione. Riprova.",
    err_payment: "Il pagamento non è andato a buon fine. Il tuo tavolo non è prenotato.",
  },

  en: {
    lang_name: "English",
    header_sub: "Reserve a table",
    steps_label: "Booking steps",
    lang_switch: "Language",

    step_1: "Date & time",
    step_2: "Party size",
    step_3: "Your details",
    step_4: "Secure hold",

    legend_1: "Date & time",
    legend_2: "Party size",
    legend_3: "Your details",
    legend_4: "Secure your table",

    label_date: "Date",
    label_time: "Time",
    time_placeholder: "Select a time",
    slots_loading: "Loading available times…",
    slots_empty: "No times left on that day. Please pick another date.",
    slots_offline: "Couldn't check availability. Times shown are not guaranteed.",

    guests_group: "Number of guests",
    guests_decrease: "Decrease guests",
    guests_increase: "Increase guests",
    guests_hint: "Larger parties ({max}+)? Contact the restaurant directly.",

    label_name: "Full name",
    label_email: "Email",
    label_phone: "Mobile number",
    label_notes: "Notes",
    optional: "(optional)",
    notes_placeholder: "Allergies, high chair, special occasion…",
    phone_placeholder: "+41 79 000 00 00",

    fee_suffix: "hold — not a charge",
    fee_body:
      "We place a temporary hold on your card or TWINT account to secure this table. It is released automatically after your reservation time. You are only charged if the restaurant marks the reservation as a no-show.",

    payment_group: "Payment method",
    pay_twint: "TWINT",
    pay_twint_desc: "Pay with the TWINT app",
    pay_card: "Card",
    pay_card_desc: "Visa · Mastercard · Apple Pay",
    slot_twint: "TWINT: you will be redirected to confirm the hold in your TWINT app.",
    slot_card: "Card: your card fields will appear here securely.",

    btn_back: "Back",
    btn_continue: "Continue",
    btn_confirm: "Confirm & place hold",
    btn_working: "Processing…",

    legal:
      "By continuing you agree to the {policy}. No-show fee of {fee} per reservation — charged only if you neither cancel nor arrive. How we use your data is described in the {privacy}.",
    legal_policy: "cancellation policy",
    legal_privacy: "privacy policy",

    conf_title: "Table reserved",
    conf_body: "A confirmation has been sent to {email}.",
    conf_ref: "Reference",
    conf_when: "When",
    conf_guests: "Guests",
    conf_guests_value: "{n} people",
    conf_manage: "View or cancel this reservation",
    conf_pending_title: "Checking your payment…",
    conf_pending_body: "Please don't close this window. It only takes a moment.",

    err_required: "Please fill in this field.",
    err_email: "Please enter a valid email address.",
    err_phone: "Please enter a valid mobile number, e.g. +41 79 000 00 00.",
    err_date_past: "Please choose a date from today onwards.",
    err_date_far: "Reservations are only possible up to {date}.",
    err_time: "Please choose a time.",
    err_slot_gone: "That time was just taken. Please choose another.",
    err_network: "No connection to the server. Check your internet connection and try again.",
    err_generic: "We couldn't secure your reservation. Please try again.",
    err_payment: "The payment was not completed. Your table is not reserved.",
  },
};
