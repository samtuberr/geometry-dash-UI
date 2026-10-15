import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from configure import generate


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).resolve().parents[2] / 'infra/account.example.json').read_text())

    def test_one_account_file_keeps_all_roots_and_github_variables_consistent(self):
        files = generate(self.config)
        bootstrap = json.loads(files['infra/bootstrap/terraform.tfvars.json'])
        production = json.loads(files['infra/production/terraform.tfvars.json'])
        github = json.loads(files['infra/github/terraform.tfvars.json'])
        self.assertEqual(production, github['production'])
        self.assertEqual(bootstrap['project_id'], production['project_id'])
        self.assertEqual(bootstrap['region'], production['region'])
        self.assertEqual(bootstrap['github_repository'], github['owner'] + '/' + github['repository'])
        self.assertFalse(github['enable_gcp_deployments'])
        buckets = [v for k, v in files.items() if k.endswith('.backend.hcl')]
        self.assertEqual(len(set(buckets)), 3)

    def test_string_boolean_cannot_accidentally_enable_deployments(self):
        self.config['enable_gcp_deployments'] = 'false'
        with self.assertRaises(ValueError):
            generate(self.config)

    def test_mismatched_zone_rejected_before_writing_files(self):
        self.config['zone'] = 'europe-west1-b'
        with self.assertRaises(ValueError):
            generate(self.config)

    def test_owner_name_cannot_replace_immutable_numeric_id(self):
        self.config['github_owner_id'] = 'someone'
        with self.assertRaises(ValueError):
            generate(self.config)
