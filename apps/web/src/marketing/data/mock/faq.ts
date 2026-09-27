import type { FaqCategory } from "../../types/faq";

/**
 * Frequently asked questions. Answers are drawn from supplied AFhomes
 * information only. Where official detail has not yet been provided, answers
 * note that information will be shared when available.
 */
export const faqCategories: FaqCategory[] = [
  {
    id: "afhomes",
    label: "About AFhomes",
    items: [
      {
        question: "Who is the AFhomes Group?",
        answer:
          "AFhomes is a diversified hospitality and wellness group in the Philippines, spanning eco-tourism, premium food and beverage, and advanced wellness hospitality. Our properties are located in Laguna — currently the ALM Japanese Restaurant, the Smart Wellness Hotel, and the Hotspring & Ecofarm Resort.",
      },
      {
        question: "What is the AFhomes vision?",
        answer:
          "Our vision centers on homestyle hospitality and wellness — building a warm, family-oriented culture of welcome across dining, stay, and escape experiences. Detailed official statements are provided on our About page.",
      },
      {
        question: "What is the AFhomes mission?",
        answer:
          "Our mission is to deliver the AFhomes promise of 'Amazing & Fun. Your Home Away From Home.' through responsible development, thoughtful wellness technology, and genuine Filipino hospitality.",
      },
      {
        question: "What does the AFhomes logo represent?",
        answer:
          "The AFhomes brand colors are deep navy, coral, pink, gold, cyan, magenta, and green — a warm, summery identity that we carry across our dining, stay, and nature experiences.",
      },
    ],
  },
  {
    id: "resort",
    label: "Hotspring & Ecofarm Resort",
    items: [
      {
        question: "Where will the Hotspring & Ecofarm Resort be located?",
        answer:
          "The resort is planned for Brgy. Perez, Calauan, Laguna — approximately 60 hectares of master-planned destination with mountain and countryside views.",
      },
      {
        question: "What will the property feature?",
        answer:
          "The concept includes 10+ natural geothermal spring sources, accommodations, an integrated ecofarm, farming education, nature-based activities, family experiences, and wellness experiences.",
      },
      {
        question: "When will the resort open?",
        answer:
          "The project is in development. It is intended to proceed phase by phase, with environmental and governmental compliance guiding the timeline. We will announce opening details when they are confirmed.",
      },
      {
        question: "How is AFhomes approaching the resort's development?",
        answer:
          "Responsibly and in phases. Environmental and governmental compliance, sustainable development, and care for the natural springs are at the center of the plan before any phase proceeds.",
      },
    ],
  },
  {
    id: "vip",
    label: "VIP Privilege",
    items: [
      {
        question: "What is the purpose of the VIP Privilege Program?",
        answer:
          "The program rewards our most valued guests with fixed discounts, priority reservation rights, welcome gifts, and loyalty stay points across the AFhomes experience.",
      },
      {
        question: "What are the benefits of each tier?",
        answer:
          "Gold offers 25% fixed discounts over 20 years. Silver offers 20% over 10 years. Bronze offers 15% over 5 years. All tiers include free entrance for the cardholder, priority reservation rights, an annual welcome gift, and annual loyalty stay points.",
      },
      {
        question: "How are payments handled?",
        answer:
          "Payments must be made directly to the AFhomes Finance Department through official and verified channels. Always confirm payment instructions with AFhomes directly before transferring funds.",
      },
      {
        question: "How do I make reservations with VIP privileges?",
        answer:
          "Priority reservation rights are applied during the reservation process. Contact AFhomes directly to have your VIP status and cardholder details applied to your booking.",
      },
    ],
  },
  {
    id: "compliance",
    label: "Compliance & Transparency",
    items: [
      {
        question: "Is AFhomes a real estate developer?",
        answer:
          "No. AFHOMES is a hospitality and resort developer and operator. It does not offer real estate investments, timeshares, club shares, or securities.",
      },
      {
        question: "Does AFhomes comply with LTS / DHSUD requirements?",
        answer:
          "Detailed compliance information — including any relevant licenses, permits, and regulatory documentation — is published on our Compliance & Transparency page as official documents become available.",
      },
      {
        question: "Is the VIP Privilege Program an investment?",
        answer:
          "No. The VIP Privilege Program is a loyalty privileges program, not an investment. AFHOMES does not offer real estate investments, timeshares, club shares, or securities.",
      },
      {
        question: "Where can I verify AFhomes corporate details?",
        answer:
          "Official corporate and compliance documentation is shared through the Compliance & Transparency page. For the head office, AFhomes Hotspring & Ecofarm Resort Corp. is located at Brgy. Perez, Calauan, Laguna 4012.",
      },
    ],
  },
];