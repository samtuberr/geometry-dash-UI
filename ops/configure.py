#!/usr/bin/env python3
"""Generate consistent local Terraform inputs. Makes no GCP or GitHub API calls."""
import argparse
import json
from pathlib import Path
import re


def generate(config):
    required = ['project_id', 'project_number', 'region', 'zone', 'github_owner',
                'github_repository', 'github_repository_id', 'github_owner_id',
                'domain', 'notification_email', 'admin_members']
    for field in required:
        if field not in config or config[field] == '':
            raise ValueError('Missing required account setting: ' + field)
    for field in ['project_number', 'github_repository_id', 'github_owner_id']:
        if not re.fullmatch(r'[0-9]+', str(config[field])):
            raise ValueError(field + ' must be a numeric ID')
    if not config['zone'].startswith(config['region'] + '-'):
        raise ValueError('zone must belong to region')
    for field in ['enable_gcp_deployments', 'manage_branch_protection']:
        if field in config and not isinstance(config[field], bool):
            raise ValueError(field + ' must be a JSON boolean')
    production = {key: config[key] for key in ['project_id', 'region', 'zone', 'domain', 'notification_email']}
    production.update(machine_type=config.get('machine_type', 'e2-small'), disk_size_gb=config.get('disk_size_gb', 20))
    bootstrap = {
        'project_id': config['project_id'], 'region': config['region'],
        'github_repository': config['github_owner'] + '/' + config['github_repository'],
        'github_repository_id': str(config['github_repository_id']),
        'github_owner_id': str(config['github_owner_id']),
        'admin_members': config['admin_members'],
        'billing_account_id': config.get('billing_account_id', ''),
        'monthly_budget_usd': config.get('monthly_budget_usd', 35),
    }
    github = {
        'owner': config['github_owner'], 'repository': config['github_repository'],
        'project_number': str(config['project_number']), 'production': production,
        'enable_gcp_deployments': config.get('enable_gcp_deployments', False),
        'manage_branch_protection': config.get('manage_branch_protection', True),
        'reviewer_user_ids': config.get('reviewer_user_ids', []),
    }
    result = {}
    for root, values in [('bootstrap', bootstrap), ('production', production), ('github', github)]:
        result[f'infra/{root}/terraform.tfvars.json'] = json.dumps(values, indent=2) + '\n'
        result[f'infra/{root}/{root}.backend.hcl'] = 'bucket = ' + json.dumps(config['project_id'] + '-tf-' + root) + '\n'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', help='Path to your copy of infra/account.example.json')
    parser.add_argument('--force', action='store_true', help='Replace previously generated local inputs')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    outputs = generate(json.loads(Path(args.config).read_text()))
    conflicts = [name for name in outputs if (root / name).exists()]
    if conflicts and not args.force:
        parser.error('Inputs already exist; review them and use --force to regenerate: ' + ', '.join(conflicts))
    for name, content in outputs.items():
        path = root / name
        path.write_text(content)
        path.chmod(0o600)
        print('Wrote ' + name)
    print('Configuration only. No cloud or GitHub resources were created.')


if __name__ == '__main__':
    main()
