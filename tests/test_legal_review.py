from __future__ import annotations
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from taku_publisher.api import TakuPublisherClient
from taku_publisher.legal_review import legal_review_action, publisher_error_output
from taku_publisher.util import PublisherError

class LegalReviewTests(unittest.TestCase):
    def test_legal_gates_stop_without_retry_or_consent(self):
        for code in ('REGISTRATION_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED', 'PUBLISHER_LEGAL_REVIEW_REQUIRED'):
            with self.subTest(code=code):
                calls = []
                def transport(method, url, headers, body, timeout):
                    calls.append((method, url, json.loads(body)))
                    return 428, {}, json.dumps({'error': code, 'documents': ['service', 'publisher'],
                        'acceptancePath': 'https://untrusted.invalid', 'message': 'fixture-private-auth'}).encode()
                client = TakuPublisherClient(token='fixture-private-auth', transport=transport)
                with self.assertRaises(PublisherError) as caught:
                    client.submit_draft('draft-123')
                output = publisher_error_output(caught.exception)
                self.assertEqual(output['status'], 'legal_review_required')
                self.assertTrue(output['requires_action'])
                self.assertFalse(output['needsAuth'])
                self.assertEqual(output['action_type'], 'review_legal_terms')
                self.assertNotIn('fixture-private-auth', json.dumps(output))
                self.assertNotIn('untrusted', json.dumps(output))
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][2], {})
                if code == 'PUBLISHER_LEGAL_REVIEW_REQUIRED':
                    self.assertEqual(output['review_url'], 'https://taku.ai/publish/draft-123')

    def test_unknown_preconditions_and_bad_sites(self):
        self.assertIsNone(legal_review_action(428, {'error': 'OTHER'}))
        self.assertIsNone(legal_review_action(401, {'error': 'REGISTRATION_REQUIRED'}))
        for site in ('javascript:alert(1)', 'https://user:secret@example.test', 'http://example.test'):
            with self.assertRaises(PublisherError):
                legal_review_action(428, {'error': 'REGISTRATION_REQUIRED'}, site_url=site)
        output = legal_review_action(428, {'error': 'LEGAL_ACCEPTANCE_REQUIRED',
            'documents': ['marketplace', 'service', '../redirect']}, site_url='http://127.0.0.1:3000/ignored?token=ignored')
        self.assertEqual(output['review_url'], 'http://127.0.0.1:3000/legal/accept?documents=service%2Cmarketplace')
